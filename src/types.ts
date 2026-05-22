export interface DocWeaverSettings {
	destinationFolder: string;
	assetSubfolder: string;
	filenameCollision: 'skip' | 'overwrite' | 'number';
	watchFolders: string[];
	watchIntervalMin: number;
	watchSubfolders: boolean;
	afterImport: 'archive' | 'delete' | 'keep';
	archiveFolder: string;
	pptxOutput: 'single' | 'per-slide';
	useWikilinks: boolean;
	openAfterImport: boolean;
	showHwpBeta: boolean;
	language: 'auto' | 'en' | 'ko' | 'ja' | 'zh';
}

export const DEFAULT_SETTINGS: DocWeaverSettings = {
	destinationFolder: 'Imported',
	assetSubfolder: '_assets',
	filenameCollision: 'number',
	watchFolders: [],
	watchIntervalMin: 5,
	watchSubfolders: false,
	afterImport: 'archive',
	archiveFolder: '',
	pptxOutput: 'single',
	useWikilinks: true,
	openAfterImport: true,
	showHwpBeta: false,
	language: 'auto',
};

export interface ConversionWarning {
	message: string;
	isBeta?: boolean;
}

export interface ConversionStats {
	headings: number;
	images: number;
	tables: number;
}

export interface AssetData {
	filename: string;
	data: ArrayBuffer;
	mimeType: string;
}

export interface ConverterOutput {
	markdown: string;
	warnings: ConversionWarning[];
	stats: ConversionStats;
	assets: AssetData[];
}

export interface ImportResult {
	success: boolean;
	sourcePath: string;
	destPath?: string;
	warnings: ConversionWarning[];
	stats?: ConversionStats;
	error?: string;
	skipped?: boolean;
}

export type SupportedExtension = 'docx' | 'pptx' | 'pdf' | 'hwp' | 'hwpx' | 'txt' | 'csv' | 'xlsx' | 'xls';

export const SUPPORTED_EXTENSIONS: SupportedExtension[] = ['docx', 'pptx', 'pdf', 'hwp', 'hwpx', 'txt', 'csv', 'xlsx', 'xls'];
