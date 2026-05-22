// Minimal type declarations for mammoth
// Full types are bundled with mammoth 1.7+
declare module 'mammoth' {
	interface Image {
		contentType: string;
		altText?: string;
		read(encoding: 'base64'): Promise<string>;
		read(encoding: 'arraybuffer'): Promise<ArrayBuffer>;
		read(): Promise<Buffer>;
	}

	interface ImageConverter {
		(image: Image): Promise<{ src: string; [key: string]: string }>;
	}

	namespace images {
		function imgElement(
			handler: (image: Image) => Promise<{ [key: string]: string }> | { [key: string]: string },
		): ImageConverter;
	}

	interface Options {
		convertImage?: ImageConverter;
		styleMap?: string | string[];
		includeDefaultStyleMap?: boolean;
		ignoreEmptyParagraphs?: boolean;
	}

	interface Message {
		type: 'warning' | 'error';
		message: string;
		paragraph?: unknown;
	}

	interface Result {
		value: string;
		messages: Message[];
	}

	type Input =
		| { arrayBuffer: ArrayBuffer }
		| { path: string }
		| { buffer: Buffer };

	function convertToHtml(input: Input, options?: Options): Promise<Result>;
	function extractRawText(input: Input): Promise<Result>;
}
