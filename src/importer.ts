import { App, Notice, TFile, normalizePath } from 'obsidian';
import { DocWeaverSettings, ImportResult, ConverterOutput, SUPPORTED_EXTENSIONS, SupportedExtension } from './types';
import { convertDocx } from './converters/docxConverter';
import { convertPlain } from './converters/plainConverter';
import { convertPdf } from './converters/pdfConverter';
import { convertPptx } from './converters/pptxConverter';
import { convertXlsx } from './converters/xlsxConverter';
import { convertHwp, convertHwpx } from './converters/hwpConverter';
import { tFormat, formatStats } from './i18n';

export class Importer {
	app: App;
	settings: DocWeaverSettings;

	constructor(app: App, settings: DocWeaverSettings) {
		this.app = app;
		this.settings = settings;
	}

	pickAndImport(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		input.accept = SUPPORTED_EXTENSIONS.map(e => `.${e}`).join(',');
		input.style.display = 'none';
		document.body.appendChild(input);

		input.onchange = async () => {
			const files = Array.from(input.files ?? []);
			document.body.removeChild(input);
			if (files.length === 0) return;
			await this.importFiles(files);
		};

		input.click();
	}

	async importFiles(files: File[]): Promise<ImportResult[]> {
		if (files.length === 1) {
			const result = await this.importSingleFile(files[0]);
			this.notifySingle(result);
			return [result];
		}

		const results: ImportResult[] = [];
		for (const file of files) {
			results.push(await this.importSingleFile(file, { skipOpen: true }));
		}
		this.notifyBulk(results);
		return results;
	}

	async importSingleFile(file: File, opts?: { skipOpen?: boolean }): Promise<ImportResult> {
		const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
		const sourceName = file.name;

		if (!SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension)) {
			new Notice(tFormat('NOTICE_UNSUPPORTED', { ext }));
			return { success: false, sourcePath: sourceName, warnings: [], error: `Unsupported: ${ext}` };
		}

		try {
			const buffer = await file.arrayBuffer();
			const output = await this.convert(buffer, ext as SupportedExtension);
			const basename = file.name.replace(/\.[^.]+$/, '');
			const destPath = await this.resolveDestPath(basename);

			if (destPath === null) {
				return { success: true, sourcePath: sourceName, warnings: output.warnings, skipped: true };
			}

			const frontmatter = this.buildFrontmatter(file.name, ext, output.frontmatterExtra);
			// Resolve bare asset filenames to vault-relative paths (non-wikilink mode)
			const markdown = output.assets.length > 0
				? this.resolveAssetLinks(output.markdown, basename)
				: output.markdown;
			const content = frontmatter + markdown;

			await this.ensureFolder(this.settings.destinationFolder);
			await this.writeNote(destPath, content);

			if (output.assets.length > 0) {
				await this.saveAssets(basename, output.assets);
			}

			if (output.additionalFiles && output.additionalFiles.length > 0) {
				await this.ensureFolder(this.settings.destinationFolder);
				for (const extra of output.additionalFiles) {
					const extraPath = await this.resolveDestPath(extra.basename);
					if (extraPath !== null) {
						await this.writeNote(extraPath, extra.content);
					}
				}
			}

			if (this.settings.openAfterImport && !opts?.skipOpen) {
				const tfile = this.app.vault.getAbstractFileByPath(destPath);
				if (tfile instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(tfile);
				}
			}

			return {
				success: true,
				sourcePath: sourceName,
				destPath,
				warnings: output.warnings,
				stats: output.stats,
			};
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			return { success: false, sourcePath: sourceName, warnings: [], error };
		}
	}

	private async convert(buffer: ArrayBuffer, ext: SupportedExtension): Promise<ConverterOutput> {
		switch (ext) {
			case 'docx':
				return convertDocx(buffer, this.settings.useWikilinks);
			case 'pdf':
				return convertPdf(buffer, this.settings.useWikilinks);
			case 'pptx':
				return convertPptx(buffer, {
					outputMode: this.settings.pptxOutput,
					useWikilinks: this.settings.useWikilinks,
				});
			case 'hwp':
			case 'hwpx': {
				if (!this.settings.showHwpBeta) {
					throw new Error('Enable "Show HWP beta features" in settings to import HWP/HWPx files.');
				}
				return ext === 'hwp'
					? convertHwp(buffer)
					: convertHwpx(buffer, this.settings.useWikilinks);
			}
			case 'xlsx':
			case 'xls':
				return convertXlsx(buffer, { outputMode: 'single' });
			case 'txt':
			case 'csv':
				return convertPlain(buffer, ext);
			default:
				throw new Error(`Converter not yet implemented for .${ext} (coming in a future milestone)`);
		}
	}

	private async resolveDestPath(basename: string): Promise<string | null> {
		const destFolder = normalizePath(this.settings.destinationFolder);
		const candidate = normalizePath(`${destFolder}/${basename}.md`);
		const exists = await this.app.vault.adapter.exists(candidate);

		if (!exists) return candidate;

		switch (this.settings.filenameCollision) {
			case 'skip':
				return null;
			case 'overwrite':
				return candidate;
			case 'number': {
				for (let i = 1; i <= 999; i++) {
					const numbered = normalizePath(`${destFolder}/${basename} ${i}.md`);
					if (!(await this.app.vault.adapter.exists(numbered))) return numbered;
				}
				return candidate; // fallback
			}
		}
	}

	private buildFrontmatter(
		filename: string,
		format: string,
		extra?: Record<string, string | boolean | number>,
	): string {
		const now = this.localISOString();
		const lines = [
			'---',
			`source_file: "${filename}"`,
			`source_format: "${format}"`,
			`imported_at: "${now}"`,
		];
		if (extra) {
			for (const [k, v] of Object.entries(extra)) {
				lines.push(`${k}: ${JSON.stringify(v)}`);
			}
		}
		lines.push('---', '');
		return lines.join('\n') + '\n';
	}

	private localISOString(): string {
		const now = new Date();
		const offset = -now.getTimezoneOffset();
		const sign = offset >= 0 ? '+' : '-';
		const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
		const mm = String(Math.abs(offset) % 60).padStart(2, '0');
		return now.toISOString().replace('Z', `${sign}${hh}:${mm}`);
	}

	private resolveAssetLinks(markdown: string, noteName: string): string {
		const assetBase = normalizePath(`${this.settings.destinationFolder}/${this.settings.assetSubfolder}/${noteName}`);

		if (this.settings.useWikilinks) {
			// Replace bare ![[filename.ext]] with path-qualified ![[assetBase/filename.ext]].
			// Without this, Obsidian searches the whole vault and resolves all same-named
			// assets (e.g. page-001.jpg from different PDFs) to the same file.
			return markdown.replace(
				/!\[\[([^\]/|#]+\.[a-zA-Z]{2,5})(|[^\]]*)?\]\]/g,
				(_, filename, alias) => `![[${assetBase}/${filename}${alias ?? ''}]]`,
			);
		}

		// Standard markdown: qualify bare filenames with the full asset path
		return markdown.replace(/!\[([^\]]*)\]\(([^/)(]+\.[a-zA-Z]{2,5})\)/g, (_, alt, filename) => {
			return `![${alt}](${assetBase}/${filename})`;
		});
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) {
			await this.app.vault.createFolder(normalized);
		}
	}

	private async writeNote(destPath: string, content: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(destPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(destPath, content);
		}
	}

	private async saveAssets(noteName: string, assets: { filename: string; data: ArrayBuffer; mimeType: string }[]): Promise<void> {
		const assetFolder = normalizePath(
			`${this.settings.destinationFolder}/${this.settings.assetSubfolder}/${noteName}`,
		);
		await this.ensureFolder(assetFolder);

		for (const asset of assets) {
			const assetPath = normalizePath(`${assetFolder}/${asset.filename}`);
			await this.app.vault.adapter.writeBinary(assetPath, asset.data);
		}
	}

	private notifySingle(result: ImportResult): void {
		const name = result.sourcePath;
		if (result.skipped) {
			new Notice(tFormat('NOTICE_SKIP', { name }));
			return;
		}
		if (!result.success) {
			new Notice(tFormat('NOTICE_ERROR', { name, error: result.error ?? '' }));
			return;
		}
		const stats = result.stats ? formatStats(result.stats.headings, result.stats.images, result.stats.tables) : '';
		const dest = result.destPath ?? this.settings.destinationFolder;
		new Notice(tFormat('NOTICE_SUCCESS', { name, dest, stats }));

		for (const w of result.warnings) {
			if (w.isBeta) new Notice(tFormat('NOTICE_BETA_WARNING', { name }));
		}
	}

	private notifyBulk(results: ImportResult[]): void {
		const success = results.filter(r => r.success && !r.skipped).length;
		const warn = results.filter(r => r.warnings.length > 0).length;
		const dest = this.settings.destinationFolder;
		new Notice(tFormat('NOTICE_BULK_SUMMARY', { success, warn, dest }));

		const errors = results.filter(r => !r.success);
		if (errors.length > 0) {
			this.appendErrorLog(errors);
		}
	}

	private async appendErrorLog(errors: ImportResult[]): Promise<void> {
		const logPath = normalizePath(`${this.settings.destinationFolder}/_import_errors.md`);
		const lines = errors.map(e => `- \`${e.sourcePath}\`: ${e.error ?? 'unknown error'}`);
		const entry = `\n### ${new Date().toISOString()}\n${lines.join('\n')}\n`;

		const existing = this.app.vault.getAbstractFileByPath(logPath);
		if (existing instanceof TFile) {
			const prev = await this.app.vault.read(existing);
			await this.app.vault.modify(existing, prev + entry);
		} else {
			await this.ensureFolder(this.settings.destinationFolder);
			await this.app.vault.create(logPath, `# Import Errors\n${entry}`);
		}
	}
}
