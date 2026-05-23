/**
 * HWP / HWPx converter — beta quality.
 * .hwp  (binary HWP5): parsed with hwp.js library
 * .hwpx (ZIP+XML):     parsed with JSZip + DOMParser
 *
 * Both formats emit isBeta:true warnings per PRD.
 */
import { unzipSync } from 'fflate';
import { AssetData, ConverterOutput, ConversionWarning } from '../types';

type ZipFiles = Record<string, Uint8Array>;
function zipText(files: ZipFiles, path: string): string {
	const data = files[path];
	return data ? new TextDecoder('utf-8').decode(data) : '';
}
function zipBinary(files: ZipFiles, path: string): ArrayBuffer | undefined {
	const data = files[path];
	if (!data) return undefined;
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

// hwp.js types (CJS import)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hwpjs = require('hwp.js') as { parse: (input: Uint8Array) => HWPDocument };

// ── Minimal hwp.js model interfaces ──────────────────────────────────────────
interface HWPDocument {
	info: DocInfo;
	sections: HWPSection[];
}
interface DocInfo {
	charShapes: CharShape[];
	binData: BinData[];
	getCharShpe(index: number): CharShape | undefined;
}
interface CharShape {
	fontBaseSize: number;
	attr: number; // bit flags: 0=bold, 1=italic, 2=underline, ...
}
interface BinData {
	data: Uint8Array;
	extension: string;
}
interface HWPSection {
	content: HWPParagraph[];
}
interface HWPParagraph {
	content: HWPChar[];
	shapeBuffer: ShapePointer[];
	controls: HWPControl[];
}
interface HWPChar {
	type: number; // 0=Char, 1=Inline, 2=Extended
	value: number | string;
}
interface ShapePointer {
	pos: number;
	shapeIndex: number;
}
interface HWPControl {
	id: string;
	cells?: HWPTableCell[][];
}
interface HWPTableCell {
	content: HWPParagraph[];
}

const CHAR_TYPE_CHAR = 0;

// ── Korean style name → heading level ─────────────────────────────────────────
const STYLE_HEADING_MAP: Record<string, number> = {
	'제목 1': 1, '제목 2': 2, '제목 3': 3,
	'제목 4': 4, '제목 5': 5, '제목 6': 6,
	'표제': 1, '부제': 2,
	'heading 1': 1, 'heading 2': 2, 'heading 3': 3,
	'heading 4': 4, 'heading 5': 5, 'heading 6': 6,
};

function styleNameToHeadingLevel(name: string): number {
	return STYLE_HEADING_MAP[name.toLowerCase().trim()] ?? 0;
}

// ── HWP binary (.hwp) ─────────────────────────────────────────────────────────

export async function convertHwp(buffer: ArrayBuffer): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [
		{ message: 'HWP binary conversion is best-effort. Formatting may be lost.', isBeta: true },
	];

	let doc: HWPDocument;
	try {
		doc = hwpjs.parse(new Uint8Array(buffer));
	} catch (err) {
		warnings.push({ message: `hwp.js parse error: ${err instanceof Error ? err.message : String(err)}`, isBeta: true });
		return {
			markdown: '> ⚠️ [beta] HWP parsing failed. The file may be unsupported or corrupted.',
			warnings,
			stats: { headings: 0, images: 0, tables: 0 },
			assets: [],
		};
	}

	const assets: AssetData[] = [];
	const lines: string[] = [];
	let headingCount = 0;
	let tableCount = 0;
	let imgIdx = 0;

	// Collect all font sizes to compute median for heading heuristic
	const fontSizes: number[] = [];
	for (const section of doc.sections) {
		for (const para of section.content) {
			const size = getParaFontSize(para, doc.info);
			if (size > 0) fontSizes.push(size);
		}
	}
	const medianSize = median(fontSizes) || 10;

	for (const section of doc.sections) {
		for (const para of section.content) {
			// Tables embedded in paragraph controls
			for (const ctrl of para.controls) {
				if (ctrl.cells) {
					lines.push(hwpTableToMd(ctrl.cells));
					tableCount++;
				}
			}

			const text = para.content
				.filter(c => c.type === CHAR_TYPE_CHAR)
				.map(c => String(c.value))
				.join('')
				.trim();

			if (!text) continue;

			const fontSize = getParaFontSize(para, doc.info);
			const headingLevel = fontSizeToHeadingLevel(fontSize, medianSize);

			if (headingLevel > 0) {
				lines.push(`${'#'.repeat(headingLevel)} ${text}`);
				headingCount++;
			} else {
				lines.push(text);
			}
		}
	}

	// Extract binary images from binData
	for (const bin of doc.info.binData) {
		if (bin.data?.length) {
			const filename = `image-${String(++imgIdx).padStart(3, '0')}.${bin.extension || 'png'}`;
			assets.push({ filename, data: bin.data.buffer as ArrayBuffer, mimeType: extToMime(bin.extension) });
		}
	}

	const markdown = lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

	return {
		markdown,
		warnings,
		stats: { headings: headingCount, images: assets.length, tables: tableCount },
		assets,
	};
}

function getParaFontSize(para: HWPParagraph, info: DocInfo): number {
	const ptr = para.shapeBuffer[0];
	if (!ptr) return 0;
	return info.getCharShpe(ptr.shapeIndex)?.fontBaseSize ?? 0;
}

function fontSizeToHeadingLevel(size: number, medianSize: number): number {
	const ratio = size / medianSize;
	if (ratio >= 2.0) return 1;
	if (ratio >= 1.6) return 2;
	if (ratio >= 1.4) return 3;
	return 0;
}

function hwpTableToMd(cells: HWPTableCell[][]): string {
	const rows = cells.map(row =>
		row.map(cell =>
			cell.content
				.flatMap(p => p.content.filter(c => c.type === CHAR_TYPE_CHAR).map(c => String(c.value)))
				.join('')
				.replace(/\|/g, '\\|')
				.trim(),
		),
	);
	if (rows.length === 0) return '';
	const colCount = Math.max(...rows.map(r => r.length));
	const pad = (r: string[]) => { while (r.length < colCount) r.push(''); return r; };
	const header = pad(rows[0]);
	const sep = header.map(() => '---');
	return [
		`| ${header.join(' | ')} |`,
		`| ${sep.join(' | ')} |`,
		...rows.slice(1).map(r => `| ${pad(r).join(' | ')} |`),
	].join('\n');
}

// ── HWPx (.hwpx, ZIP + XML) ───────────────────────────────────────────────────

export async function convertHwpx(buffer: ArrayBuffer, useWikilinks: boolean): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [
		{ message: 'HWPx conversion is best-effort. Formatting may be lost.', isBeta: true },
	];

	const zip = unzipSync(new Uint8Array(buffer));
	const assets: AssetData[] = [];
	const lines: string[] = [];
	let headingCount = 0;
	let tableCount = 0;

	const styleMap = buildHwpxStyleMap(zip);

	const sectionPaths = Object.keys(zip)
		.filter(p => /contents\/section\d+\.xml$/i.test(p))
		.sort();

	if (sectionPaths.length === 0) {
		warnings.push({ message: 'No section content found in HWPx file.', isBeta: true });
		return { markdown: '', warnings, stats: { headings: 0, images: 0, tables: 0 }, assets };
	}

	for (const sectionPath of sectionPaths) {
		const xml = zipText(zip, sectionPath);
		if (!xml) continue;
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const { md, h, t } = parseHwpxSection(doc, styleMap, useWikilinks);
		lines.push(md);
		headingCount += h;
		tableCount += t;
	}

	let imgIdx = 0;
	const binPaths = Object.keys(zip).filter(p => /contents\/bindata\//i.test(p) && !p.endsWith('/'));
	for (const binPath of binPaths) {
		const data = zipBinary(zip, binPath);
		if (!data) continue;
		const ext = binPath.split('.').pop()?.toLowerCase() ?? 'png';
		const filename = `image-${String(++imgIdx).padStart(3, '0')}.${ext}`;
		assets.push({ filename, data, mimeType: extToMime(ext) });
	}

	const markdown = lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

	return {
		markdown,
		warnings,
		stats: { headings: headingCount, images: assets.length, tables: tableCount },
		assets,
	};
}

function buildHwpxStyleMap(zip: ZipFiles): Map<string, number> {
	const map = new Map<string, number>();

	const candidates = ['Contents/header.xml', 'Contents/section0.xml', 'header.xml'];
	for (const path of candidates) {
		const xml = zipText(zip, path);
		if (!xml) continue;

		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		// Match both STYLE and ParaStyle elements
		const styles = Array.from(doc.querySelectorAll('STYLE, PARASTYLE, ParaStyle'));
		for (const el of styles) {
			const id = el.getAttribute('Id') ?? el.getAttribute('id') ?? '';
			const name = el.getAttribute('Name') ?? el.getAttribute('name') ?? '';
			const level = styleNameToHeadingLevel(name);
			if (id && level > 0) map.set(id, level);
		}
		if (map.size > 0) break;
	}

	return map;
}

function parseHwpxSection(
	doc: Document,
	styleMap: Map<string, number>,
	useWikilinks: boolean,
): { md: string; h: number; t: number } {
	const lines: string[] = [];
	let h = 0;
	let t = 0;

	// Paragraphs — try multiple tag names for compatibility
	const paras = Array.from(doc.querySelectorAll('P, Para, para'));

	for (const para of paras) {
		// Skip paragraphs inside table cells (handled separately)
		if (para.closest('CELL, Cell, TD, cell')) continue;

		const styleId = para.getAttribute('StyleId') ?? para.getAttribute('StyleID') ?? para.getAttribute('styleId') ?? '';
		const headingLevel = styleMap.get(styleId) ?? 0;

		const text = extractHwpxText(para).trim();
		if (!text) continue;

		if (headingLevel > 0) {
			lines.push(`${'#'.repeat(headingLevel)} ${text}`);
			h++;
		} else {
			lines.push(text);
		}
	}

	// Tables
	const tables = Array.from(doc.querySelectorAll('TABLE, Table, table'));
	for (const tbl of tables) {
		lines.push(hwpxTableToMd(tbl));
		t++;
	}

	return { md: lines.join('\n\n'), h, t };
}

function extractHwpxText(el: Element): string {
	// Collect text from CHAR, Char, T elements
	const charEls = el.querySelectorAll('CHAR, Char, T, text');
	if (charEls.length > 0) {
		return Array.from(charEls).map(c => c.textContent ?? '').join('');
	}
	// Fallback: direct text content
	return el.textContent ?? '';
}

function hwpxTableToMd(tbl: Element): string {
	const rows = Array.from(tbl.querySelectorAll('ROW, Row, TR, tr'));
	const data = rows.map(row =>
		Array.from(row.querySelectorAll('CELL, Cell, TD, td')).map(cell =>
			extractHwpxText(cell).replace(/\|/g, '\\|').trim(),
		),
	);
	if (data.length === 0) return '';
	const colCount = Math.max(...data.map(r => r.length));
	const pad = (r: string[]) => { while (r.length < colCount) r.push(''); return r; };
	const header = pad(data[0]);
	const sep = header.map(() => '---');
	return [
		`| ${header.join(' | ')} |`,
		`| ${sep.join(' | ')} |`,
		...data.slice(1).map(r => `| ${pad(r).join(' | ')} |`),
	].join('\n');
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function median(nums: number[]): number {
	if (nums.length === 0) return 0;
	const sorted = [...nums].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function extToMime(ext: string): string {
	const map: Record<string, string> = {
		png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
		gif: 'image/gif', bmp: 'image/bmp', wmf: 'image/wmf', emf: 'image/emf',
	};
	return map[(ext ?? '').toLowerCase()] ?? 'image/png';
}
