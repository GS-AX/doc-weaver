import JSZip from 'jszip';
import { AdditionalFile, AssetData, ConverterOutput, ConversionWarning } from '../types';

// OOXML namespace URIs
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DC = 'http://purl.org/dc/elements/1.1/';

const REL_SLIDE = `${R_NS}/slide`;
const REL_NOTES = `${R_NS}/notesSlide`;
const REL_IMAGE = `${R_NS}/image`;

export interface PptxOptions {
	outputMode: 'single' | 'per-slide';
	useWikilinks: boolean;
}

interface RelEntry {
	id: string;
	type: string;
	target: string;
}

interface ParsedSlide {
	number: number;
	title: string;
	bodyMd: string;
	notesMd: string;
	assets: AssetData[];
	tableCount: number;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function convertPptx(buffer: ArrayBuffer, options: PptxOptions): Promise<ConverterOutput> {
	const zip = await JSZip.loadAsync(buffer);
	const warnings: ConversionWarning[] = [];
	const allAssets: AssetData[] = [];

	const deckTitle = await getDeckTitle(zip);
	const slidePaths = await getSlideOrder(zip);

	const slides: ParsedSlide[] = [];
	let imgCounter = 0;

	for (let i = 0; i < slidePaths.length; i++) {
		const slide = await parseSlide(zip, slidePaths[i], i + 1, imgCounter, options.useWikilinks);
		imgCounter += slide.assets.length;
		slides.push(slide);
		allAssets.push(...slide.assets);
	}

	let markdown: string;
	let additionalFiles: AdditionalFile[] | undefined;

	if (options.outputMode === 'per-slide') {
		const result = buildPerSlide(deckTitle, slides);
		markdown = result.index;
		additionalFiles = result.slides;
	} else {
		markdown = buildSingleNote(deckTitle, slides);
	}

	return {
		markdown,
		warnings,
		stats: {
			headings: slides.length + (deckTitle ? 1 : 0),
			images: allAssets.length,
			tables: slides.reduce((n, s) => n + s.tableCount, 0),
		},
		assets: allAssets,
		additionalFiles,
	};
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────

function parseXml(xml: string): Document {
	return new DOMParser().parseFromString(xml, 'text/xml');
}

/** ppt/slides/slide1.xml → ppt/slides/_rels/slide1.xml.rels */
function relsPathFor(filePath: string): string {
	const slash = filePath.lastIndexOf('/');
	return `${filePath.slice(0, slash + 1)}_rels/${filePath.slice(slash + 1)}.rels`;
}

/** Resolve a relative path (../media/img.png) against a base file path */
function resolvePath(baseFile: string, relative: string): string {
	if (relative.startsWith('/')) return relative.slice(1);
	const parts = baseFile.split('/').slice(0, -1); // dir parts
	for (const seg of relative.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.') parts.push(seg);
	}
	return parts.join('/');
}

function parseRels(xml: string): RelEntry[] {
	if (!xml) return [];
	const doc = parseXml(xml);
	return Array.from(doc.getElementsByTagName('Relationship')).map(el => ({
		id: el.getAttribute('Id') ?? '',
		type: el.getAttribute('Type') ?? '',
		target: el.getAttribute('Target') ?? '',
	}));
}

// ── Presentation-level helpers ────────────────────────────────────────────────

async function getDeckTitle(zip: JSZip): Promise<string> {
	const coreXml = await zip.file('docProps/core.xml')?.async('string') ?? '';
	if (coreXml) {
		const doc = parseXml(coreXml);
		const title = doc.getElementsByTagNameNS(DC, 'title')[0]?.textContent?.trim();
		if (title) return title;
	}
	return '';
}

async function getSlideOrder(zip: JSZip): Promise<string[]> {
	const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string') ?? '';
	const rels = parseRels(relsXml);
	const slideRels = rels.filter(r => r.type === REL_SLIDE);

	// Map rId → resolved path
	const idToPath = new Map(slideRels.map(r => [r.id, resolvePath('ppt/presentation.xml', r.target)]));

	// Use slide order from presentation.xml
	const presXml = await zip.file('ppt/presentation.xml')?.async('string') ?? '';
	if (presXml) {
		const doc = parseXml(presXml);
		const sldIds = Array.from(doc.getElementsByTagNameNS(P, 'sldId'));
		const ordered: string[] = [];
		for (const el of sldIds) {
			const rId = el.getAttributeNS(R_NS, 'id') ?? el.getAttribute('r:id') ?? '';
			const path = idToPath.get(rId);
			if (path) ordered.push(path);
		}
		if (ordered.length > 0) return ordered;
	}

	return Array.from(idToPath.values());
}

// ── Slide parser ──────────────────────────────────────────────────────────────

async function parseSlide(
	zip: JSZip,
	slidePath: string,
	slideNum: number,
	imgOffset: number,
	useWikilinks: boolean,
): Promise<ParsedSlide> {
	const slideXml = await zip.file(slidePath)?.async('string') ?? '';
	const slideDoc = parseXml(slideXml);

	const relsXml = await zip.file(relsPathFor(slidePath))?.async('string') ?? '';
	const rels = parseRels(relsXml);
	const relById = new Map(rels.map(r => [r.id, r]));

	let title = '';
	const bodyParts: string[] = [];
	const assets: AssetData[] = [];
	let tableCount = 0;
	let imgIdx = imgOffset;

	// Text shapes
	for (const sp of Array.from(slideDoc.getElementsByTagNameNS(P, 'sp'))) {
		const phEl = getNS(sp, P, 'ph') ?? getNS(sp, P, 'nvSpPr/nvPr/ph');
		const phType = phEl?.getAttribute('type') ?? '';
		const isTitle = phType === 'title' || phType === 'ctrTitle';

		const txBody = sp.getElementsByTagNameNS(P, 'txBody')[0] ??
			sp.getElementsByTagNameNS(A, 'txBody')[0];
		if (!txBody) continue;

		if (isTitle) {
			title = extractParaText(txBody.getElementsByTagNameNS(A, 'p')[0]).trim();
		} else {
			const lines = extractBodyLines(txBody);
			if (lines.length > 0) bodyParts.push(lines.join('\n'));
		}
	}

	// Tables
	for (const frame of Array.from(slideDoc.getElementsByTagNameNS(P, 'graphicFrame'))) {
		const tbl = frame.getElementsByTagNameNS(A, 'tbl')[0];
		if (!tbl) continue;
		bodyParts.push(parseTable(tbl));
		tableCount++;
	}

	// Images
	for (const pic of Array.from(slideDoc.getElementsByTagNameNS(P, 'pic'))) {
		const blipFill = pic.getElementsByTagNameNS(P, 'blipFill')[0];
		const blip = blipFill?.getElementsByTagNameNS(A, 'blip')[0];
		const rId = blip?.getAttributeNS(R_NS, 'embed') ?? blip?.getAttribute('r:embed') ?? '';
		const rel = relById.get(rId);
		if (!rel || rel.type !== REL_IMAGE) continue;

		const mediaPath = resolvePath(slidePath, rel.target);
		const data = await zip.file(mediaPath)?.async('arraybuffer');
		if (!data) continue;

		const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png';
		const filename = `image-${String(++imgIdx).padStart(3, '0')}.${ext}`;
		assets.push({ filename, data, mimeType: extToMime(ext) });

		const link = useWikilinks ? `![[${filename}]]` : `![](${filename})`;
		bodyParts.push(link);
	}

	// Speaker notes
	const notesRel = rels.find(r => r.type === REL_NOTES);
	let notesMd = '';
	if (notesRel) {
		const notesPath = resolvePath(slidePath, notesRel.target);
		const notesXml = await zip.file(notesPath)?.async('string') ?? '';
		if (notesXml) {
			notesMd = extractNotes(parseXml(notesXml));
		}
	}

	return {
		number: slideNum,
		title,
		bodyMd: bodyParts.join('\n\n').trim(),
		notesMd,
		assets,
		tableCount,
	};
}

// ── XML text extraction helpers ───────────────────────────────────────────────

function getNS(el: Element, ns: string, localName: string): Element | null {
	// Supports simple 'tag' or 'parent/child' paths
	const parts = localName.split('/');
	let cur: Element | null = el;
	for (const part of parts) {
		cur = cur?.getElementsByTagNameNS(ns, part)[0] ?? null;
		if (!cur) return null;
	}
	return cur;
}

function extractParaText(para: Element | undefined): string {
	if (!para) return '';
	return Array.from(para.getElementsByTagNameNS(A, 'r'))
		.map(r => r.getElementsByTagNameNS(A, 't')[0]?.textContent ?? '')
		.join('');
}

function extractBodyLines(txBody: Element): string[] {
	const lines: string[] = [];
	for (const para of Array.from(txBody.getElementsByTagNameNS(A, 'p'))) {
		const text = extractParaText(para).trim();
		if (!text) continue;

		const pPr = para.getElementsByTagNameNS(A, 'pPr')[0];
		const lvl = parseInt(pPr?.getAttribute('lvl') ?? '0');
		const hasBuNone = (pPr?.getElementsByTagNameNS(A, 'buNone').length ?? 0) > 0;
		const hasBullet =
			(pPr?.getElementsByTagNameNS(A, 'buChar').length ?? 0) > 0 ||
			(pPr?.getElementsByTagNameNS(A, 'buAutoNum').length ?? 0) > 0;

		const asBullet = (hasBullet || lvl > 0) && !hasBuNone;
		lines.push(asBullet ? `${'  '.repeat(lvl)}- ${text}` : text);
	}
	return lines;
}

function extractNotes(doc: Document): string {
	const lines: string[] = [];
	for (const sp of Array.from(doc.getElementsByTagNameNS(P, 'sp'))) {
		// Skip slide-number placeholder
		const ph = sp.getElementsByTagNameNS(P, 'ph')[0];
		if (ph?.getAttribute('type') === 'sldNum' || ph?.getAttribute('idx') === '0') continue;

		const txBody = sp.getElementsByTagNameNS(P, 'txBody')[0];
		if (!txBody) continue;
		lines.push(...extractBodyLines(txBody));
	}
	const text = lines.join('\n').trim();
	return text;
}

function parseTable(tbl: Element): string {
	const rows = Array.from(tbl.getElementsByTagNameNS(A, 'tr'));
	if (rows.length === 0) return '';

	const data = rows.map(row =>
		Array.from(row.getElementsByTagNameNS(A, 'tc')).map(cell => {
			const txBody = cell.getElementsByTagNameNS(A, 'txBody')[0];
			return txBody ? extractBodyLines(txBody).join(' ').replace(/\|/g, '\\|') : '';
		}),
	);

	const colCount = Math.max(...data.map(r => r.length));
	const pad = (r: string[]) => { while (r.length < colCount) r.push(''); return r; };

	const header = pad(data[0]);
	const sep = header.map(() => '---');
	const body = data.slice(1).map(pad);

	return [
		`| ${header.join(' | ')} |`,
		`| ${sep.join(' | ')} |`,
		...body.map(r => `| ${r.join(' | ')} |`),
	].join('\n');
}

function extToMime(ext: string): string {
	const map: Record<string, string> = {
		png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
		gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
		emf: 'image/emf', wmf: 'image/wmf',
	};
	return map[ext] ?? 'image/png';
}

// ── Markdown builders ─────────────────────────────────────────────────────────

function slideSection(slide: ParsedSlide, headingLevel: 2 | 1 = 2): string {
	const prefix = '#'.repeat(headingLevel);
	const titleLine = slide.title
		? `${prefix} Slide ${slide.number}: ${slide.title}`
		: `${prefix} Slide ${slide.number}`;

	const parts: string[] = [titleLine];
	if (slide.bodyMd) parts.push(slide.bodyMd);
	if (slide.notesMd) parts.push(`> **Notes:** ${slide.notesMd.replace(/\n/g, '\n> ')}`);

	return parts.join('\n\n');
}

function buildSingleNote(deckTitle: string, slides: ParsedSlide[]): string {
	const parts: string[] = [];
	if (deckTitle) parts.push(`# ${deckTitle}`);
	parts.push(slides.map(s => slideSection(s, 2)).join('\n\n---\n\n'));
	return parts.join('\n\n').trim();
}

function buildPerSlide(
	deckTitle: string,
	slides: ParsedSlide[],
): { index: string; slides: AdditionalFile[] } {
	const safeTitle = deckTitle || 'Presentation';

	// Index note
	const indexLines: string[] = [`# ${safeTitle}`, ''];
	const slideFiles: AdditionalFile[] = [];

	for (const slide of slides) {
		const basename = `${safeTitle} - Slide ${String(slide.number).padStart(2, '0')}`;
		indexLines.push(`- [[${basename}]]`);

		const content = slideSection(slide, 1);
		slideFiles.push({ basename, content });
	}

	return { index: indexLines.join('\n'), slides: slideFiles };
}
