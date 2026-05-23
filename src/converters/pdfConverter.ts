import * as zlib from 'zlib';
import { ConverterOutput, ConversionWarning } from '../types';

export async function convertPdf(buffer: ArrayBuffer): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];
	try {
		const pages = await extractPages(Buffer.from(buffer));
		const allText = pages.filter(p => p.trim()).join('\n\n---\n\n').trim();
		if (!allText) return buildScannedStub(warnings);
		const markdown = textToMarkdown(allText);
		return { markdown, warnings, stats: countStats(markdown), assets: [] };
	} catch {
		return buildScannedStub(warnings);
	}
}

async function extractPages(buf: Buffer): Promise<string[]> {
	const raw = buf.toString('binary');
	const pages: string[] = [];

	// Match PDF stream objects: <<header>> stream\n...\nendstream
	const streamRe = /<<([\s\S]{1,800}?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
	let m: RegExpExecArray | null;

	while ((m = streamRe.exec(raw)) !== null) {
		const header = m[1];
		const body = m[2];

		// Skip image/font/metadata streams
		if (/\/Subtype\s*\/(Image|Form|XML|Metadata|Type1C|CIDFontType|OpenType)/i.test(header)) continue;
		// Only process streams likely to contain page text
		if (header.includes('/Type') && !/\/Page/i.test(header) && !/\/Content/i.test(header) && !/\/Resources/i.test(header)) {
			// Allow if no /Type at all (most content streams have no /Type)
		}

		let content: string;
		if (/\/Filter\s*\/FlateDecode/.test(header)) {
			try {
				content = (await zlibInflate(Buffer.from(body, 'binary'))).toString('binary');
			} catch {
				continue;
			}
		} else if (/\/Filter/.test(header)) {
			continue; // Other filters unsupported
		} else {
			content = body;
		}

		const text = parseContentStream(content);
		if (text.trim()) pages.push(text);
	}

	return pages;
}

function zlibInflate(buf: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zlib.inflate(buf, (err, result) => {
			if (!err) { resolve(result); return; }
			zlib.inflateRaw(buf, (err2, result2) => {
				if (!err2) resolve(result2);
				else reject(err2);
			});
		});
	});
}

function parseContentStream(stream: string): string {
	const lines: string[] = [];
	let cur = '';

	// Match BT...ET blocks
	const btEt = /BT\b([\s\S]*?)\bET\b/g;
	let block: RegExpExecArray | null;

	while ((block = btEt.exec(stream)) !== null) {
		const ops = block[1];
		cur = '';

		// Tokenise: (string)Tj  (string)'  [(arr)]TJ  TD Td T*
		const tok = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")|\[([\s\S]*?)\]\s*TJ|T[Dd*]/g;
		let t: RegExpExecArray | null;

		while ((t = tok.exec(ops)) !== null) {
			const full = t[0];
			if (full.startsWith('(')) {
				cur += decodePdfStr(t[1]);
			} else if (full.startsWith('[')) {
				cur += decodeTJArray(t[2]);
			} else {
				// Td / TD / T* → new line
				if (cur.trim()) { lines.push(cur.trim()); cur = ''; }
			}
		}

		if (cur.trim()) lines.push(cur.trim());
	}

	return lines.join('\n');
}

function decodeTJArray(inner: string): string {
	const out: string[] = [];
	const re = /\(([^)\\]*(?:\\.[^)\\]*)*)\)|-?\d+\.?\d*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(inner)) !== null) {
		if (m[0].startsWith('(')) {
			out.push(decodePdfStr(m[1]));
		} else {
			const n = parseFloat(m[0]);
			if (n < -200) out.push(' '); // large negative kerning = word space
		}
	}
	return out.join('');
}

function decodePdfStr(s: string): string {
	return s
		.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
		.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t')
		.replace(/\\(.)/g, '$1');
}

function textToMarkdown(text: string): string {
	const out: string[] = [];
	for (const line of text.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		const lvl = headingLevel(t);
		out.push(lvl ? `${'#'.repeat(lvl)} ${t}` : t);
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function headingLevel(line: string): number {
	if (line.length > 80) return 0;
	if (/^\d+\.\d+\s+\S/.test(line) && line.length < 60) return 3;   // "1.1 Title"
	if (/^\d+\s+[A-Z]/.test(line) && line.length < 60) return 2;      // "1 Title"
	if (line === line.toUpperCase() && /[A-Z]{3}/.test(line) && line.length < 50) return 2; // ALL CAPS
	return 0;
}

function buildScannedStub(warnings: ConversionWarning[]): ConverterOutput {
	warnings.push({ message: 'PDF has no extractable text layer (scanned or encrypted).' });
	const markdown = '> ⚠️ This PDF has no extractable text layer (scanned image or encrypted).\n> Original file is referenced in the frontmatter above.';
	return { markdown, warnings, stats: { headings: 0, images: 0, tables: 0 }, assets: [], frontmatterExtra: { pdf_has_text_layer: false } };
}

function countStats(md: string): { headings: number; images: number; tables: number } {
	return {
		headings: (md.match(/^#{1,6} /gm) ?? []).length,
		images: 0,
		tables: (md.match(/^\|/gm) ?? []).length > 0 ? 1 : 0,
	};
}
