import { ConverterOutput, ConversionWarning } from '../types';

// SheetJS — supports .xlsx and .xls
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx');

export interface XlsxOptions {
	/** One note per sheet (default) or all sheets in a single note */
	outputMode: 'per-sheet' | 'single';
}

export async function convertXlsx(
	buffer: ArrayBuffer,
	_options: XlsxOptions = { outputMode: 'single' },
): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];
	const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

	if (workbook.SheetNames.length === 0) {
		return { markdown: '', warnings, stats: { headings: 0, images: 0, tables: 0 }, assets: [] };
	}

	const sections: string[] = [];
	let totalTables = 0;

	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		const { markdown, rows } = sheetToMarkdown(sheet, sheetName);

		if (rows === 0) {
			warnings.push({ message: `Sheet "${sheetName}" is empty — skipped.` });
			continue;
		}

		totalTables++;
		sections.push(markdown);
	}

	const markdown = sections.join('\n\n').trim();

	return {
		markdown,
		warnings,
		stats: { headings: workbook.SheetNames.length, images: 0, tables: totalTables },
		assets: [],
	};
}

function getCellText(sheet: import('xlsx').WorkSheet, r: number, c: number): string {
	const addr = XLSX.utils.encode_cell({ r, c });
	const cell = sheet[addr];
	if (!cell) return '';
	// Use formatted string (w) when available — respects Excel's number/date/currency formats
	if (cell.w !== undefined) return String(cell.w).trim();
	if (cell.v === undefined || cell.v === null) return '';
	if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toLocaleDateString();
	return String(cell.v).trim();
}

function sheetToMarkdown(sheet: import('xlsx').WorkSheet, sheetName: string): { markdown: string; rows: number } {
	const refStr = sheet['!ref'];
	if (!refStr) return { markdown: '', rows: 0 };

	const range = XLSX.utils.decode_range(refStr);
	const numRows = range.e.r - range.s.r + 1;
	const numCols = range.e.c - range.s.c + 1;

	// Build 2D grid using formatted cell values
	const grid: string[][] = Array.from({ length: numRows }, (_, ri) =>
		Array.from({ length: numCols }, (_, ci) => getCellText(sheet, range.s.r + ri, range.s.c + ci)),
	);

	// Fill merged cells: all cells in a merge get the top-left cell's value
	const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = sheet['!merges'] ?? [];
	for (const merge of merges) {
		const value = grid[merge.s.r - range.s.r]?.[merge.s.c - range.s.c] ?? '';
		for (let r = merge.s.r; r <= merge.e.r; r++) {
			for (let c = merge.s.c; c <= merge.e.c; c++) {
				const ri = r - range.s.r;
				const ci = c - range.s.c;
				if (ri >= 0 && ri < numRows && ci >= 0 && ci < numCols) {
					grid[ri][ci] = value;
				}
			}
		}
	}

	// Escape pipes/newlines and drop fully-empty rows
	const escaped = grid
		.map(row => row.map(cell => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')))
		.filter(row => row.some(cell => cell !== ''));

	if (escaped.length === 0) return { markdown: '', rows: 0 };

	const header = escaped[0];

	// Right-align columns whose non-header values all look numeric
	const separator = header.map((_, ci) => {
		const colVals = escaped.slice(1).map(r => r[ci]).filter(v => v !== '');
		const isNumeric = colVals.length > 0 && colVals.every(v => /^-?[\d,. ]+%?$/.test(v));
		return isNumeric ? '--:' : '--';
	});

	const body = escaped.slice(1);

	const lines = [
		`## ${sheetName}`,
		'',
		`| ${header.join(' | ')} |`,
		`| ${separator.join(' | ')} |`,
		...body.map(r => `| ${r.join(' | ')} |`),
	];

	return { markdown: lines.join('\n'), rows: escaped.length };
}
