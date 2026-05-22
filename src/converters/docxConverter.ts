import mammoth from 'mammoth';
import { AssetData, ConverterOutput, ConversionWarning } from '../types';
import { htmlToMarkdown } from '../htmlToMarkdown';

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

	return { markdown, warnings, stats, assets };
}
