import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { AssetData, ConverterOutput, ConversionWarning } from '../types';

// Run pdfjs in fake-worker (main-thread) mode.
// pdfjs checks globalThis.pdfjsWorker?.WorkerMessageHandler; if set, it skips
// the real Worker thread and the GlobalWorkerOptions.workerSrc requirement entirely.
(globalThis as any).pdfjsWorker = { WorkerMessageHandler };

// pdfjs rendering operator IDs for embedded images (stable across pdfjs v4.x)
// 83 = paintInlineImageXObject, 85 = paintImageXObject, 88 = paintImageXObjectRepeat
const IMAGE_OPS = new Set([83, 85, 88]);

interface Line {
	y: number;
	fontSize: number;
	text: string;
}

export async function convertPdf(buffer: ArrayBuffer, useWikilinks = true): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];

	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: true });
	const pdf = await loadingTask.promise;

	const allLines: Line[] = [];
	let hasTextLayer = false;
	const pagesWithImages: number[] = [];

	for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
		const page = await pdf.getPage(pageNum);

		// Run text extraction and operator list scan in parallel
		const [content, ops] = await Promise.all([
			page.getTextContent(),
			page.getOperatorList() as Promise<{ fnArray: number[]; argsArray: unknown[][] }>,
		]);

		const items = content.items.filter((item): item is TextItem => 'str' in item && item.str.trim() !== '');
		if (items.length > 0) hasTextLayer = true;

		const lines = groupIntoLines(items);
		allLines.push(...lines);

		if (ops.fnArray.some(fn => IMAGE_OPS.has(fn))) {
			pagesWithImages.push(pageNum);
		}

		if (pageNum < pdf.numPages && lines.length > 0) {
			allLines.push({ y: -1, fontSize: 0, text: '---PAGE_BREAK---' });
		}
	}

	if (!hasTextLayer) {
		return renderScannedPages(pdf, warnings, useWikilinks);
	}

	// Render pages that contain embedded images as visual supplements
	const assets: AssetData[] = [];
	for (const pageNum of pagesWithImages) {
		const page = await pdf.getPage(pageNum);
		const asset = await renderPageToJpeg(page, pageNum);
		if (asset) assets.push(asset);
	}

	let markdown = linesToMarkdown(allLines);

	if (assets.length > 0) {
		markdown += '\n\n---\n\n';
		for (const asset of assets) {
			markdown += '\n' + (useWikilinks ? `![[${asset.filename}]]` : `![](${asset.filename})`);
		}
		warnings.push({
			message: `${assets.length} page(s) contain embedded images and are rendered as visual supplements below the text.`,
		});
	}

	return {
		markdown,
		warnings,
		stats: countStats(markdown),
		assets,
	};
}

// ── Render a single PDF page to JPEG ─────────────────────────────────────────

async function renderPageToJpeg(page: any, pageNum: number): Promise<AssetData | null> {
	const SCALE = 1.5; // ~150 DPI equivalent for A4
	const viewport = page.getViewport({ scale: SCALE });

	const canvas = document.createElement('canvas');
	canvas.width = Math.floor(viewport.width);
	canvas.height = Math.floor(viewport.height);
	const ctx = canvas.getContext('2d');

	if (!ctx) {
		canvas.width = 0;
		canvas.height = 0;
		return null;
	}

	await page.render({ canvasContext: ctx, viewport }).promise;

	const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
	const data = await blob.arrayBuffer();

	// Release canvas memory immediately
	canvas.width = 0;
	canvas.height = 0;

	return {
		filename: `page-${String(pageNum).padStart(3, '0')}.jpg`,
		data,
		mimeType: 'image/jpeg',
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

	for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
		const page = await pdf.getPage(pageNum);
		const asset = await renderPageToJpeg(page, pageNum);
		if (!asset) continue;

		assets.push(asset);
		lines.push(useWikilinks ? `![[${asset.filename}]]` : `![Page ${pageNum}](${asset.filename})`);
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

// ── Text PDF helpers ──────────────────────────────────────────────────────────

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

	const xs = items.map(i => i.transform[4]);
	const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
	const leftItems = items.filter(i => i.transform[4] <= midX);
	const rightItems = items.filter(i => i.transform[4] > midX);

	let text: string;
	if (rightItems.length > 0 && leftItems.length > 0 && rightItems[0].transform[4] - leftItems[leftItems.length - 1].transform[4] > 100) {
		text = [...leftItems, ...rightItems].map(i => i.str).join(' ').trim();
	} else {
		text = items.map(i => i.str).join(' ').trim();
	}

	return { y, fontSize, text };
}

function linesToMarkdown(lines: Line[]): string {
	if (lines.length === 0) return '';

	const sizes = lines.filter(l => l.fontSize > 0).map(l => l.fontSize).sort((a, b) => a - b);
	const median = sizes[Math.floor(sizes.length / 2)] ?? 12;

	const parts: string[] = [];

	for (const line of lines) {
		if (line.text === '---PAGE_BREAK---') {
			parts.push('\n---\n');
			continue;
		}
		if (!line.text) continue;

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
	}

	return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function countStats(md: string): { headings: number; images: number; tables: number } {
	const headings = (md.match(/^#{1,6} /gm) ?? []).length;
	const images = (md.match(/!\[/g) ?? []).length;
	const tables = (md.match(/^\|/gm) ?? []).length > 0 ? 1 : 0;
	return { headings, images, tables };
}
