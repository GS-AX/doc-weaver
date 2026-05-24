import mammoth from 'mammoth';
import { unzipSync } from 'fflate';
import { AssetData, ConverterOutput, ConversionWarning } from '../types';
import { htmlToMarkdown } from '../htmlToMarkdown';
import { parseChartXml } from './chartParser';

export async function convertDocx(buffer: ArrayBuffer, useWikilinks: boolean): Promise<ConverterOutput> {
	const warnings: ConversionWarning[] = [];
	const assets: AssetData[] = [];
	let imgIndex = 0;

	const options: mammoth.Options = {
		convertImage: mammoth.images.imgElement(async (image: mammoth.Image) => {
			const ext = image.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
			const filename = `image-${String(++imgIndex).padStart(3, '0')}.${ext}`;
			const data = await image.read('arraybuffer');
			assets.push({ filename, data: data as ArrayBuffer, mimeType: image.contentType });
			return { src: `__ASSET__${filename}` };
		}),
	};

	const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, options);

	for (const msg of result.messages) {
		if (msg.type === 'warning') {
			warnings.push({ message: msg.message });
		}
	}

	const { markdown, stats } = htmlToMarkdown(result.value, useWikilinks);

	// Extract embedded charts from the DOCX ZIP
	const chartMd = extractDocxCharts(buffer);
	if (chartMd.length > 0) {
		stats.tables += chartMd.length;
	}

	const finalMarkdown = chartMd.length > 0
		? `${markdown}\n\n---\n\n## Embedded Charts\n\n${chartMd.join('\n\n')}`
		: markdown;

	return { markdown: finalMarkdown, warnings, stats, assets };
}

function extractDocxCharts(buffer: ArrayBuffer): string[] {
	try {
		const zip = unzipSync(new Uint8Array(buffer));
		const dec = new TextDecoder('utf-8');

		// Primary: word/charts/*.xml (modern Word format)
		const directCharts = Object.keys(zip)
			.filter(p => /word\/charts\//i.test(p) && p.endsWith('.xml') && !/\.rels$/i.test(p))
			.sort()
			.map(p => parseChartXml(dec.decode(zip[p])))
			.filter((md): md is string => md !== null);

		if (directCharts.length > 0) return directCharts;

		// Fallback: charts inside embedded Excel workbooks (word/embeddings/*.xlsx)
		// LibreOffice and some older Word documents store chart data this way.
		const embeddedCharts: string[] = [];
		const xlsxPaths = Object.keys(zip).filter(p => /word\/embeddings\/.*\.xlsx$/i.test(p));
		for (const xlsxPath of xlsxPaths) {
			try {
				const innerZip = unzipSync(zip[xlsxPath]);
				const innerCharts = Object.keys(innerZip)
					.filter(p => /xl\/charts\//i.test(p) && p.endsWith('.xml') && !/\.rels$/i.test(p))
					.sort()
					.map(p => parseChartXml(dec.decode(innerZip[p])))
					.filter((md): md is string => md !== null);
				embeddedCharts.push(...innerCharts);
			} catch {
				// Skip unreadable embedded files
			}
		}
		return embeddedCharts;
	} catch {
		return [];
	}
}
