import { ConversionStats } from './types';

export interface HtmlConvertResult {
	markdown: string;
	stats: ConversionStats;
}

export function htmlToMarkdown(html: string, useWikilinks = true): HtmlConvertResult {
	const stats: ConversionStats = { headings: 0, images: 0, tables: 0 };
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const md = nodeToMd(doc.body, 0, stats, useWikilinks);
	return {
		markdown: md.replace(/\n{3,}/g, '\n\n').trim(),
		stats,
	};
}

function nodeToMd(node: Node, listDepth: number, stats: ConversionStats, wikilinks: boolean): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent ?? '';
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return '';

	const el = node as Element;
	const tag = el.tagName.toLowerCase();
	const children = () =>
		Array.from(el.childNodes)
			.map(n => nodeToMd(n, listDepth, stats, wikilinks))
			.join('');

	switch (tag) {
		case 'h1': case 'h2': case 'h3':
		case 'h4': case 'h5': case 'h6': {
			stats.headings++;
			const level = parseInt(tag[1]);
			return `\n${'#'.repeat(level)} ${children().trim()}\n\n`;
		}

		case 'p':
			return `\n${children().trim()}\n\n`;

		case 'strong': case 'b':
			return `**${children()}**`;

		case 'em': case 'i':
			return `*${children()}*`;

		case 's': case 'del': case 'strike':
			return `~~${children()}~~`;

		case 'a': {
			const href = el.getAttribute('href') ?? '';
			const text = children().trim();
			if (!href) return text;
			return `[${text}](${href})`;
		}

		case 'img': {
			stats.images++;
			const src = el.getAttribute('src') ?? '';
			const alt = el.getAttribute('alt') ?? 'image';
			// __ASSET__filename.ext is a placeholder set by docxConverter
			if (src.startsWith('__ASSET__')) {
				const filename = src.slice('__ASSET__'.length);
				return wikilinks ? `![[${filename}]]` : `![${alt}](${filename})`;
			}
			return wikilinks ? `![[${alt}]]` : `![${alt}](${src})`;
		}

		case 'ul': {
			const items = listChildren(el, 'ul', listDepth, stats, wikilinks);
			return `\n${items}\n`;
		}

		case 'li':
			return children();

		case 'table':
			return convertTable(el, listDepth, stats, wikilinks);

		case 'blockquote': {
			const inner = children().trim();
			return '\n' + inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
		}

		case 'code': {
			if (el.parentElement?.tagName.toLowerCase() === 'pre') {
				return el.textContent ?? '';
			}
			return `\`${el.textContent}\``;
		}

		case 'pre': {
			const codeEl = el.querySelector('code');
			const lang = codeEl?.className.replace('language-', '') ?? '';
			const text = (codeEl?.textContent ?? el.textContent ?? '').replace(/\s+$/, '');
			return `\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
		}

		case 'br':
			return '\n';

		case 'hr':
			return '\n\n---\n\n';

		case 'sup': {
			// Footnote reference from mammoth: <sup><a href="#...">1</a></sup>
			const text = el.textContent?.trim() ?? '';
			return `[^${text}]`;
		}

		// Footnote definition at bottom: mammoth uses <ol> with specific class
		case 'ol': {
			if (el.className.includes('footnotes')) {
				return convertFootnotes(el, listDepth, stats, wikilinks);
			}
			const items = listChildren(el, 'ol', listDepth, stats, wikilinks);
			return `\n${items}\n`;
		}

		case 'body': case 'div': case 'section': case 'article': case 'main':
		case 'span': case 'thead': case 'tbody': case 'tfoot':
			return children();

		default:
			return children();
	}
}

function listChildren(
	el: Element,
	type: 'ul' | 'ol',
	depth: number,
	stats: ConversionStats,
	wikilinks: boolean,
): string {
	const indent = '  '.repeat(depth);
	let idx = 1;
	const lines: string[] = [];

	for (const child of Array.from(el.childNodes)) {
		const childEl = child as Element;
		if (childEl.tagName?.toLowerCase() !== 'li') continue;

		const prefix = type === 'ul' ? `${indent}- ` : `${indent}${idx++}. `;
		let text = '';
		const nested: string[] = [];

		for (const n of Array.from(childEl.childNodes)) {
			const tag = (n as Element).tagName?.toLowerCase();
			if (tag === 'ul' || tag === 'ol') {
				nested.push(nodeToMd(n, depth + 1, stats, wikilinks));
			} else {
				text += nodeToMd(n, depth, stats, wikilinks);
			}
		}

		const line = prefix + text.trim();
		lines.push(nested.length ? line + '\n' + nested.join('') : line);
	}

	return lines.join('\n');
}

function convertTable(
	el: Element,
	depth: number,
	stats: ConversionStats,
	wikilinks: boolean,
): string {
	const rows = Array.from(el.querySelectorAll('tr'));
	if (rows.length === 0) return '';
	stats.tables++;

	// Build a proper 2D grid that handles colspan and rowspan.
	// occupied maps "r,c" -> cell text; cells filled by a span get empty string.
	const occupied = new Map<string, string>();
	const rowWidths: number[] = [];

	for (let ri = 0; ri < rows.length; ri++) {
		let ci = 0;
		for (const cell of Array.from(rows[ri].querySelectorAll('th, td'))) {
			// Advance past columns already filled by a rowspan from a previous row
			while (occupied.has(`${ri},${ci}`)) ci++;

			const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') ?? '1') || 1);
			const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') ?? '1') || 1);
			const text = nodeToMd(cell, depth, stats, wikilinks).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ');

			for (let dr = 0; dr < rowspan; dr++) {
				for (let dc = 0; dc < colspan; dc++) {
					// Only the top-left cell of the span gets the text; the rest get ''
					occupied.set(`${ri + dr},${ci + dc}`, dr === 0 && dc === 0 ? text : '');
				}
			}
			ci += colspan;
		}
		// Count trailing rowspan-filled cells
		while (occupied.has(`${ri},${ci}`)) ci++;
		rowWidths.push(ci);
	}

	const numRows = rows.length;
	const numCols = Math.max(...rowWidths, 0);
	if (numCols === 0) return '';

	const grid = Array.from({ length: numRows }, (_, ri) =>
		Array.from({ length: numCols }, (_, ci) => occupied.get(`${ri},${ci}`) ?? ''),
	);

	const header = grid[0];
	const separator = header.map(() => '---');
	const body = grid.slice(1);

	const lines = [
		`| ${header.join(' | ')} |`,
		`| ${separator.join(' | ')} |`,
		...body.map(r => `| ${r.join(' | ')} |`),
	];

	return `\n${lines.join('\n')}\n\n`;
}

function convertFootnotes(
	el: Element,
	depth: number,
	stats: ConversionStats,
	wikilinks: boolean,
): string {
	const items = Array.from(el.querySelectorAll('li'));
	if (items.length === 0) return '';

	const lines = items.map((li, i) => {
		const id = li.id ?? String(i + 1);
		const num = id.replace(/\D/g, '') || String(i + 1);
		const text = Array.from(li.childNodes)
			.map(n => nodeToMd(n, depth, stats, wikilinks))
			.join('')
			.trim();
		return `[^${num}]: ${text}`;
	});

	return '\n\n' + lines.join('\n') + '\n';
}
