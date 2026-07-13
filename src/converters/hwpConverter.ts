/**
 * HWP / HWPx converter — beta quality.
 * .hwp  (binary HWP5): parsed with hwp.js library
 * .hwpx (ZIP+XML):     parsed with fflate + DOMParser
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
	getCharShape(index: number): CharShape | undefined;
}
interface CharShape {
	fontBaseSize: number;
	attr: number;
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

// ── Korean style name → heading level ────────────────────────────────────────
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

export async function convertHwp(buffer: ArrayBuffer, useWikilinks = true): Promise<ConverterOutput> {
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

	for (const bin of doc.info.binData) {
		if (bin.data?.length) {
			const filename = `image-${String(++imgIdx).padStart(3, '0')}.${bin.extension || 'png'}`;
			const data = bin.data.buffer.slice(bin.data.byteOffset, bin.data.byteOffset + bin.data.byteLength) as ArrayBuffer;
			assets.push({ filename, data, mimeType: extToMime(bin.extension) });
			lines.push(useWikilinks ? `![[${filename}]]` : `![](${filename})`);
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
	const ptr = para.shapeBuffer?.[0];
	if (!ptr) return 0;
	// hwp.js has a typo in some versions; try both spellings
	const getter = info.getCharShpe ?? info.getCharShape;
	return getter?.call(info, ptr.shapeIndex)?.fontBaseSize ?? 0;
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

// HWPx XML uses namespace prefixes like <hh:P>, <hh:T>, <hh:RUN>, etc.
// querySelectorAll('P') does NOT match <hh:P> in namespace-aware XML parsing.
// Use getElementsByTagName('*') + localName filter instead.
function byLocalName(node: Document | Element, ...names: string[]): Element[] {
	const upper = new Set(names.map(n => n.toUpperCase()));
	const root = node instanceof Document ? node.documentElement : node;
	if (!root) return [];
	return Array.from(root.getElementsByTagName('*')).filter(el => upper.has(el.localName.toUpperCase()));
}


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
		.filter(p => /section\d+\.xml$/i.test(p))
		.sort();

	if (sectionPaths.length === 0) {
		warnings.push({ message: 'No section content found in HWPx file.', isBeta: true });
		return { markdown: '', warnings, stats: { headings: 0, images: 0, tables: 0 }, assets };
	}

	// Build binData map and ordered ref list before walking sections.
	// HWPx stores images in BinData/BIN00001.PNG etc.; section XML references them by numeric ID.
	let imgIdx = 0;
	const binDataMap = new Map<number, string>(); // numericId → image markdown ref
	const orderedRefs: string[] = [];             // refs in extraction order (for sequential fallback)
	const binPaths = Object.keys(zip).filter(p => /bindata\//i.test(p) && !p.endsWith('/')).sort();
	for (const binPath of binPaths) {
		const data = zipBinary(zip, binPath);
		if (!data) continue;
		const ext = binPath.split('.').pop()?.toLowerCase() ?? 'png';
		if (!['png', 'jpg', 'jpeg', 'gif', 'bmp', 'wmf', 'emf'].includes(ext)) continue;
		const filename = `image-${String(++imgIdx).padStart(3, '0')}.${ext}`;
		assets.push({ filename, data, mimeType: extToMime(ext) });
		const ref = useWikilinks ? `![[${filename}]]` : `![](${filename})`;
		orderedRefs.push(ref);
		const m = binPath.match(/(\d+)\.[^/.]+$/);
		if (m) binDataMap.set(parseInt(m[1]), ref);
		binDataMap.set(imgIdx, ref);
	}

	const placedIds = new Set<number>();
	const imageCursor = { i: 0 }; // shared sequential fallback cursor across all sections

	for (const sectionPath of sectionPaths) {
		const xml = zipText(zip, sectionPath);
		if (!xml) continue;
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const { md, h, t } = parseHwpxSection(doc, styleMap, binDataMap, placedIds, orderedRefs, imageCursor);
		if (md) lines.push(md);
		headingCount += h;
		tableCount += t;
	}

	// Append any images not placed inline (sequential fallback exhausted all inline placements)
	for (let i = imageCursor.i; i < orderedRefs.length; i++) {
		lines.push(orderedRefs[i]);
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

	// Find header.xml regardless of path casing or directory depth
	const headerPath = Object.keys(zip).find(p => /header\.xml$/i.test(p));
	const candidates = headerPath
		? [headerPath]
		: ['Contents/header.xml', 'header.xml'];

	for (const path of candidates) {
		const xml = zipText(zip, path);
		if (!xml) continue;

		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		// Match both namespaced and non-namespaced style elements
		const styles = byLocalName(doc, 'PARASTYLE', 'STYLE');
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

// HWPx element localNames that indicate an image/drawing container.
// When attribute-based ID detection fails, these trigger sequential fallback placement.
const HWPX_IMAGE_ELEMENT_NAMES = new Set([
	'PICTURE', 'PICTURECTRL', 'GSHAPEOBJECT', 'GSHAPE', 'DRAWINGOBJECT',
	'DRAWOBJ', 'IMG', 'IMAGE', 'IMAGEDATA', 'PICOBJ', 'SHAPECOMPONENT',
]);

function parseHwpxSection(
	doc: Document,
	styleMap: Map<string, number>,
	binDataMap: Map<number, string>,
	placedIds: Set<number>,
	orderedRefs: string[],
	imageCursor: { i: number },
): { md: string; h: number; t: number } {
	const lines: string[] = [];
	let h = 0;
	let t = 0;

	function walk(el: Element) {
		const name = el.localName.toUpperCase();

		// Tables: convert as a unit, do not recurse into children
		if (['TABLE', 'TBL'].includes(name)) {
			const mdTable = hwpxTableToMd(el);
			if (mdTable) { lines.push(mdTable); t++; }
			return;
		}

		// Attribute-based image detection (any element, any attribute naming convention)
		const binId = getHwpxBinId(el);
		if (binId !== null) {
			const ref = binDataMap.get(binId);
			if (ref && !placedIds.has(binId)) {
				lines.push(ref);
				placedIds.add(binId);
			}
			return; // image element — do not recurse further
		}

		// Sequential fallback: element localName strongly suggests an image container
		// but no recognisable ID attribute was found — take the next unplaced image in order
		if (HWPX_IMAGE_ELEMENT_NAMES.has(name)) {
			if (imageCursor.i < orderedRefs.length) {
				lines.push(orderedRefs[imageCursor.i++]);
			}
			return;
		}

		// Paragraph: extract text, then fall through to recurse so inline image
		// controls inside the paragraph are also visited
		if (['P', 'PARA'].includes(name)) {
			const styleId =
				el.getAttribute('StyleId') ??
				el.getAttribute('StyleID') ??
				el.getAttribute('styleId') ??
				'';
			const headingLevel = styleMap.get(styleId) ?? 0;
			const text = extractHwpxText(el).trim();
			if (headingLevel > 0) {
				if (text) { lines.push(`${'#'.repeat(headingLevel)} ${text}`); h++; }
			} else {
				if (text) lines.push(text);
			}
			// fall through — recurse into children to find inline image controls
		}

		// Recurse into children for all non-table, non-image elements (including P)
		for (const child of Array.from(el.children)) {
			walk(child);
		}
	}

	for (const child of Array.from(doc.documentElement.children)) {
		walk(child);
	}

	return { md: lines.join('\n\n'), h, t };
}

/** Detect a BinData numeric ID from any attribute on an element.
 *  Checks named ID attributes first, then scans all attributes for a
 *  BinData path like "BinData/BIN00001.png" (actual HWPx href pattern). */
function getHwpxBinId(el: Element): number | null {
	const idAttrs = [
		'BinItemIDRef', 'binItemIDRef', 'BinItemID', 'binItemID',
		'BinDataID', 'binDataID', 'BinDataIDRef', 'binDataIDRef',
		'idRef', 'itemIDRef',
	];
	for (const attr of idAttrs) {
		const val = el.getAttribute(attr);
		if (val && /^\d+$/.test(val.trim())) return parseInt(val.trim());
	}
	// Scan every attribute for a BinData path reference, e.g. href="BinData/BIN00001.png"
	for (const attr of Array.from(el.attributes)) {
		const m = attr.value.match(/BIN0*(\d+)\.[a-zA-Z]{2,5}/i);
		if (m) return parseInt(m[1]);
	}
	return null;
}

function extractHwpxText(el: Element): string {
	// HWPx uses <hh:T> (or <T>) for text runs; also try <hh:RUN>/<hh:CHAR>
	const textEls = byLocalName(el, 'T', 'CHAR');
	if (textEls.length > 0) {
		return textEls.map(c => c.textContent ?? '').join('');
	}
	// Fallback: direct text content (strips all child element tags)
	return el.textContent ?? '';
}

function hwpxTableToMd(tbl: Element): string {
	const rows = byLocalName(tbl, 'ROW', 'TR');
	const data = rows.map(row =>
		byLocalName(row, 'CELL', 'TD', 'TC').map(cell =>
			extractHwpxText(cell).replace(/\|/g, '\\|').trim(),
		),
	);
	if (data.length === 0) return '';
	const colCount = Math.max(...data.map(r => r.length));
	if (colCount === 0) return '';
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
