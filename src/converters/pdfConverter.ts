import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { ConverterOutput, ConversionWarning } from '../types';

// Disable the worker — Obsidian plugins run in a single thread
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

interface Line {
	y: number;
	fontSize: number;
	text: string;
}

export async function convertPdf(buffer: ArrayBuffer): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];

	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: true });
	const pdf = await loadingTask.promise;

	const allLines: Line[] = [];
	let hasTextLayer = false;

	for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
		const page = await pdf.getPage(pageNum);
		const content = await page.getTextContent();

		const items = content.items.filter((item): item is TextItem => 'str' in item && item.str.trim() !== '');
		if (items.length > 0) hasTextLayer = true;

		const lines = groupIntoLines(items);
		allLines.push(...lines);

		// Page separator (except after last page)
		if (pageNum < pdf.numPages && lines.length > 0) {
			allLines.push({ y: -1, fontSize: 0, text: '---PAGE_BREAK---' });
		}
	}

	if (!hasTextLayer) {
		return buildScannedStub(warnings);
	}

	const markdown = linesToMarkdown(allLines);

	return {
		markdown,
		warnings,
		stats: countStats(markdown),
		assets: [],
	};
}

// Group raw text items into logical lines by Y-coordinate proximity
function groupIntoLines(items: TextItem[]): Line[] {
	if (items.length === 0) return [];

	// Sort by Y descending (PDF Y is bottom-up), then X ascending
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
	// Font size = scaleY component of transform matrix
	const fontSize = Math.abs(items[0].transform[3]);
	const y = items[0].transform[5];

	// Detect two-column layout: bimodal X split
	const xs = items.map(i => i.transform[4]);
	const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
	const leftItems = items.filter(i => i.transform[4] <= midX);
	const rightItems = items.filter(i => i.transform[4] > midX);

	let text: string;
	if (rightItems.length > 0 && leftItems.length > 0 && rightItems[0].transform[4] - leftItems[leftItems.length - 1].transform[4] > 100) {
		// Two-column: merge left then right in reading order
		text = [...leftItems, ...rightItems].map(i => i.str).join(' ').trim();
	} else {
		text = items.map(i => i.str).join(' ').trim();
	}

	return { y, fontSize, text };
}

function linesToMarkdown(lines: Line[]): string {
	if (lines.length === 0) return '';

	// Compute median body font size for heading detection
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

function buildScannedStub(warnings: ConversionWarning[]): ConverterOutput {
	warnings.push({ message: 'PDF has no text layer (scanned image). Text extraction was not possible.' });

	const markdown = '> ⚠️ This PDF has no text layer (scanned image). Text extraction was not possible.';

	return {
		markdown,
		warnings,
		stats: { headings: 0, images: 0, tables: 0 },
		assets: [],
	};
}

function countStats(md: string): { headings: number; images: number; tables: number } {
	const headings = (md.match(/^#{1,6} /gm) ?? []).length;
	const images = (md.match(/!\[/g) ?? []).length;
	const tables = (md.match(/^\|/gm) ?? []).length > 0 ? 1 : 0;
	return { headings, images, tables };
}
