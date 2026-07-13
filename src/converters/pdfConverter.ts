import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { AssetData, ConverterOutput, ConversionWarning } from '../types';

// Run pdfjs in fake-worker (main-thread) mode.
(globalThis as any).pdfjsWorker = { WorkerMessageHandler };

// Pull operator IDs directly from the installed pdfjs build to avoid version skew.
const _OPS = (pdfjsLib as any).OPS as Record<string, number>;
const OP_SAVE = _OPS.save;           // 10
const OP_RESTORE = _OPS.restore;     // 11
const OP_TRANSFORM = _OPS.transform; // 12
const IMAGE_OPS = new Set([
	_OPS.paintImageXObject,            // 85 – general raster XObject (JPEG, PNG …)
	_OPS.paintInlineImageXObject,      // 86 – inline image
	_OPS.paintInlineImageXObjectGroup, // 87 – inline image group
	_OPS.paintImageXObjectRepeat,      // 88 – repeated raster XObject
]);

// Minimum canvas pixels for a crop to be considered a real image (filters icons/decorations)
const MIN_IMAGE_PX = 50;
// Padding around each detected image crop, in canvas pixels.
// Keep small so captions/figure labels below the chart are not captured.
const CROP_PADDING = 4;

// Gap between adjacent text items that signals a table column boundary.
// A gap > max(COL_GAP_MIN, fontSize * COL_GAP_FACTOR) is treated as a column break.
const COL_GAP_MIN = 15;    // pt — absolute minimum
const COL_GAP_FACTOR = 2;  // relative to font size
// Tolerance for matching column X positions across consecutive rows
const COL_X_TOLERANCE = 30; // pt

type Mat6 = [number, number, number, number, number, number];

/** Post-multiply two affine matrices. */
function concatMat(m: Mat6, n: Mat6): Mat6 {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

interface TextColumn { x: number; text: string; }

interface Line {
	y: number;
	fontSize: number;
	text: string;
	cols?: TextColumn[];       // present when columnar text is detected (table rows)
	imageFilename?: string;    // present for inline image placeholders
}

interface BBox { x: number; y: number; w: number; h: number; }

// ── Column detection ──────────────────────────────────────────────────────────

function detectColumns(items: TextItem[], fontSize: number): TextColumn[] | null {
	if (items.length < 2) return null;

	const threshold = Math.max(COL_GAP_MIN, fontSize * COL_GAP_FACTOR);
	const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);

	const groups: { x: number; items: TextItem[] }[] = [
		{ x: sorted[0].transform[4], items: [sorted[0]] },
	];

	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		// gap = distance from end of previous item to start of current item
		const gap = curr.transform[4] - (prev.transform[4] + (prev.width || 0));
		if (gap > threshold) {
			groups.push({ x: curr.transform[4], items: [curr] });
		} else {
			groups[groups.length - 1].items.push(curr);
		}
	}

	if (groups.length < 2) return null;

	return groups.map(g => ({
		x: g.x,
		text: g.items.map(i => i.str).join('').trim(),
	}));
}

// ── Text line grouping ────────────────────────────────────────────────────────

function groupIntoLines(items: TextItem[]): Line[] {
	if (items.length === 0) return [];

	const sorted = [...items].sort((a, b) => {
		const ay = a.transform[5];
		const by = b.transform[5];
		if (Math.abs(ay - by) > 2) return by - ay;
		return a.transform[4] - b.transform[4];
	});

	const lines: Line[] = [];
	let currentLine: TextItem[] = [sorted[0]];
	let currentY = sorted[0].transform[5];

	for (let i = 1; i < sorted.length; i++) {
		const item = sorted[i];
		const y = item.transform[5];
		if (Math.abs(y - currentY) <= 3) {
			currentLine.push(item);
		} else {
			lines.push(mergeLine(currentLine));
			currentLine = [item];
			currentY = y;
		}
	}
	lines.push(mergeLine(currentLine));

	return lines;
}

function mergeLine(items: TextItem[]): Line {
	const fontSize = Math.abs(items[0].transform[3]);
	const y = items[0].transform[5];

	// Try column detection first
	const cols = detectColumns(items, fontSize);
	if (cols) {
		return { y, fontSize, text: cols.map(c => c.text).join('   '), cols };
	}

	// Fall back to simple left-to-right merge
	const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
	return { y, fontSize, text: sorted.map(i => i.str).join('').trim() };
}

// ── Image bounding box detection ──────────────────────────────────────────────

/**
 * Walk the pdfjs operator list, tracking CTM via save/restore/transform.
 * For each embedded raster image, compute its bounding box in canvas pixels.
 */
function detectImageBBoxes(
	ops: { fnArray: number[]; argsArray: unknown[][] },
	pageView: number[],
	scale: number,
	canvasW: number,
	canvasH: number,
): BBox[] {
	let ctm: Mat6 = [1, 0, 0, 1, 0, 0];
	const stack: Mat6[] = [];
	const bboxes: BBox[] = [];

	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i] as number;
		const args = ops.argsArray[i] as number[] | null;

		if (fn === OP_SAVE) {
			stack.push([...ctm] as Mat6);
		} else if (fn === OP_RESTORE) {
			const top = stack.pop();
			if (top) ctm = top;
		} else if (fn === OP_TRANSFORM) {
			if (Array.isArray(args) && args.length >= 6) {
				ctm = concatMat(ctm, args as Mat6);
			}
		} else if (IMAGE_OPS.has(fn)) {
			// Image occupies [0,0]→[1,1] in the current CTM's coordinate space.
			const [a, b, c, d, e, f] = ctm;
			const pdfXs = [e, a + e, c + e, a + c + e];
			const pdfYs = [f, b + f, d + f, b + d + f];
			const minPdfX = Math.min(...pdfXs);
			const maxPdfX = Math.max(...pdfXs);
			const minPdfY = Math.min(...pdfYs);
			const maxPdfY = Math.max(...pdfYs);

			// viewport.transform for rotation=0: [scale, 0, 0, -scale, -view[0]*scale, view[3]*scale]
			const rawX = (minPdfX - pageView[0]) * scale - CROP_PADDING;
			const rawY = (pageView[3] - maxPdfY) * scale - CROP_PADDING;
			const rawW = (maxPdfX - minPdfX) * scale + 2 * CROP_PADDING;
			const rawH = (maxPdfY - minPdfY) * scale + 2 * CROP_PADDING;

			const sx = Math.max(0, rawX);
			const sy = Math.max(0, rawY);
			const ex = Math.min(canvasW, rawX + rawW);
			const ey = Math.min(canvasH, rawY + rawH);

			if (ex - sx >= MIN_IMAGE_PX && ey - sy >= MIN_IMAGE_PX) {
				bboxes.push({ x: sx, y: sy, w: ex - sx, h: ey - sy });
			}
		}
	}

	return bboxes;
}

// ── Markdown rendering ────────────────────────────────────────────────────────

function pageLinesToMarkdown(lines: Line[], median: number, useWikilinks: boolean): string {
	const parts: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Inline image placeholder
		if (line.imageFilename) {
			parts.push(useWikilinks ? `![[${line.imageFilename}]]` : `![](${line.imageFilename})`);
			i++;
			continue;
		}

		if (line.text === '---PAGE_BREAK---') {
			parts.push('\n---\n');
			i++;
			continue;
		}

		// Try to start a table block if this line has columns
		if (line.cols && line.cols.length >= 2) {
			const refCols = line.cols;
			const tableRows: Line[] = [line];
			let j = i + 1;

			while (j < lines.length) {
				const next = lines[j];
				if (!next.cols || next.cols.length < 2) break;
				// Columns must match in count and X position
				if (next.cols.length !== refCols.length) break;
				const aligned = refCols.every((rc, k) => Math.abs(rc.x - next.cols![k].x) <= COL_X_TOLERANCE);
				if (!aligned) break;
				tableRows.push(next);
				j++;
			}

			if (tableRows.length >= 2) {
				// Emit as a markdown table
				const colCount = refCols.length;
				const mkRow = (cols: TextColumn[]) => {
					const cells = cols.map(c => c.text.replace(/\|/g, '\\|'));
					while (cells.length < colCount) cells.push('');
					return `| ${cells.join(' | ')} |`;
				};
				parts.push('\n' + mkRow(refCols));
				parts.push('| ' + refCols.map(() => '---').join(' | ') + ' |');
				for (const tr of tableRows.slice(1)) {
					parts.push(mkRow(tr.cols!));
				}
				parts.push('');
				i = j;
				continue;
			}
			// Only one column line — not enough for a table; fall through to plain text
		}

		if (!line.text) { i++; continue; }

		const ratio = line.fontSize / median;
		if (ratio >= 2.0) {
			parts.push(`\n# ${line.text}\n`);
		} else if (ratio >= 1.6) {
			parts.push(`\n## ${line.text}\n`);
		} else if (ratio >= 1.4) {
			parts.push(`\n### ${line.text}\n`);
		} else {
			parts.push(line.text);
		}
		i++;
	}

	return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Main converter ────────────────────────────────────────────────────────────

export async function convertPdf(buffer: ArrayBuffer, useWikilinks = true): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];

	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: true });
	const pdf = await loadingTask.promise;

	// Collect per-page lines (text + image placeholders) in a single pass.
	// We need all font sizes before rendering markdown (to compute global median).
	const pagesLines: Line[][] = [];
	const assets: AssetData[] = [];
	let hasTextLayer = false;
	let imgSeq = 0;

	for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
		const page = await pdf.getPage(pageNum);

		const [content, ops] = await Promise.all([
			page.getTextContent(),
			page.getOperatorList() as Promise<{ fnArray: number[]; argsArray: unknown[][] }>,
		]);

		const items = content.items.filter((item): item is TextItem => 'str' in item && item.str.trim() !== '');
		if (items.length > 0) hasTextLayer = true;

		const pageLines: Line[] = groupIntoLines(items);

		const SCALE = 2.0;
		const viewport = page.getViewport({ scale: SCALE });
		const cw = Math.floor(viewport.width);
		const ch = Math.floor(viewport.height);
		const pageView = page.view ?? [0, 0, viewport.width / SCALE, viewport.height / SCALE];

		const bboxes = detectImageBBoxes(ops, pageView, SCALE, cw, ch);

		if (bboxes.length > 0) {
			const offscreen = document.createElement('canvas');
			offscreen.width = cw;
			offscreen.height = ch;
			const ctx = offscreen.getContext('2d');

			if (ctx) {
				await page.render({ canvasContext: ctx, viewport }).promise;

				for (const bbox of bboxes) {
					imgSeq++;
					const filename = `image-p${String(pageNum).padStart(2, '0')}-${String(imgSeq).padStart(2, '0')}.jpg`;

					const crop = document.createElement('canvas');
					crop.width = Math.ceil(bbox.w);
					crop.height = Math.ceil(bbox.h);
					const cropCtx = crop.getContext('2d');
					if (cropCtx) {
						cropCtx.drawImage(offscreen, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
						const blob = await canvasToBlob(crop, 'image/jpeg', 0.9);
						assets.push({ filename, data: await blob.arrayBuffer(), mimeType: 'image/jpeg' });
					}
					crop.width = 0;
					crop.height = 0;

					const pdfMidY = pageView[3] - (bbox.y + bbox.h / 2) / SCALE;
					pageLines.push({ y: pdfMidY, fontSize: 0, text: '', imageFilename: filename });
				}

				offscreen.width = 0;
				offscreen.height = 0;
			}

			pageLines.sort((a, b) => b.y - a.y);
		}

		pagesLines.push(pageLines);
	}

	if (!hasTextLayer) {
		return renderScannedPages(pdf, warnings, useWikilinks);
	}

	// Compute global median font size across all pages.
	const allSizes = pagesLines
		.flatMap(pl => pl.filter(l => l.fontSize > 0).map(l => l.fontSize))
		.sort((a, b) => a - b);
	const median = allSizes[Math.floor(allSizes.length / 2)] ?? 12;

	const pageMarkdowns = pagesLines
		.map(lines => pageLinesToMarkdown(lines, median, useWikilinks))
		.filter(md => md.length > 0);

	const markdown = pageMarkdowns.join('\n\n---\n\n').trim();

	return {
		markdown,
		warnings,
		stats: countStats(markdown),
		assets,
	};
}

// ── Scanned PDF: render each page to JPEG and embed as images ────────────────

async function renderScannedPages(
	pdf: PDFDocumentProxy,
	warnings: ConversionWarning[],
	useWikilinks: boolean,
): Promise<ConverterOutput> {
	warnings.push({ message: `PDF has no text layer. ${pdf.numPages} page(s) rendered as images.` });

	const assets: AssetData[] = [];
	const lines: string[] = [
		'> ⚠️ This PDF has no text layer (scanned image). Pages are rendered as images below.',
		'',
	];

	const SCALE = 2.0;

	for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
		const page = await pdf.getPage(pageNum);
		const viewport = page.getViewport({ scale: SCALE });

		const canvas = document.createElement('canvas');
		canvas.width = Math.floor(viewport.width);
		canvas.height = Math.floor(viewport.height);
		const ctx = canvas.getContext('2d');

		if (!ctx) { canvas.width = 0; canvas.height = 0; continue; }

		await page.render({ canvasContext: ctx, viewport }).promise;

		const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
		const filename = `page-${String(pageNum).padStart(3, '0')}.jpg`;
		assets.push({ filename, data: await blob.arrayBuffer(), mimeType: 'image/jpeg' });
		lines.push(useWikilinks ? `![[${filename}]]` : `![Page ${pageNum}](${filename})`);

		canvas.width = 0;
		canvas.height = 0;
	}

	return {
		markdown: lines.join('\n'),
		warnings,
		stats: { headings: 0, images: assets.length, tables: 0 },
		assets,
		frontmatterExtra: { pdf_has_text_layer: false },
	};
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			blob => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
			type,
			quality,
		),
	);
}

function countStats(md: string): { headings: number; images: number; tables: number } {
	const headings = (md.match(/^#{1,6} /gm) ?? []).length;
	const images = (md.match(/!\[/g) ?? []).length;
	const tables = (md.match(/^\|\s*:?-+:?\s*\|/gm) ?? []).length;
	return { headings, images, tables };
}
