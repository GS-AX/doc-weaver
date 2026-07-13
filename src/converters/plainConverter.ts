import { ConverterOutput } from '../types';

export async function convertPlain(buffer: ArrayBuffer, ext: string): Promise<ConverterOutput> {
	const text = new TextDecoder('utf-8').decode(buffer);

	let markdown: string;
	if (ext === 'csv') {
		markdown = convertCsv(text);
	} else {
		markdown = text;
	}

	return {
		markdown,
		warnings: [],
		stats: { headings: 0, images: 0, tables: ext === 'csv' ? 1 : 0 },
		assets: [],
	};
}

function convertCsv(csv: string): string {
	const lines = csv.trim().split(/\r?\n/);
	if (lines.length === 0) return '';

	const rows = lines.map(line => parseCsvLine(line).map(cell => cell.replace(/\|/g, '\\|')));
	const colCount = Math.max(...rows.map(r => r.length));
	const pad = (row: string[]) => {
		while (row.length < colCount) row.push('');
		return row;
	};

	const header = pad(rows[0]);
	const separator = header.map(() => '---');
	const body = rows.slice(1).map(pad);

	const mdRows = [
		`| ${header.join(' | ')} |`,
		`| ${separator.join(' | ')} |`,
		...body.map(r => `| ${r.join(' | ')} |`),
	];

	return mdRows.join('\n') + '\n';
}

function parseCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			cells.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	cells.push(current.trim());
	return cells;
}
