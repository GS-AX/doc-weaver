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
	options: XlsxOptions = { outputMode: 'single' },
): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];
	const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

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

function sheetToMarkdown(sheet: import('xlsx').WorkSheet, sheetName: string): { markdown: string; rows: number } {
	const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
	const numRows = range.e.r - range.s.r + 1;
	const numCols = range.e.c - range.s.c + 1;

	if (numRows === 0 || numCols === 0) return { markdown: '', rows: 0 };

	// Convert sheet to array-of-arrays (empty cells become '')
	const data: string[][] = XLSX.utils.sheet_to_json(sheet, {
		header: 1,
		defval: '',
		blankrows: false,
	}) as string[][];

	if (data.length === 0) return { markdown: '', rows: 0 };

	// Normalise all values to strings and escape pipe characters
	const escaped = data.map(row =>
		Array.from({ length: numCols }, (_, i) => String(row[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')),
	);

	const header = escaped[0];
	const separator = header.map(() => '---');
	const body = escaped.slice(1);

	const lines = [
		`## ${sheetName}`,
		'',
		`| ${header.join(' | ')} |`,
		`| ${separator.join(' | ')} |`,
		...body.map(r => `| ${r.join(' | ')} |`),
	];

	return { markdown: lines.join('\n'), rows: data.length };
}
