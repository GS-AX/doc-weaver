import * as fs from 'fs';
import * as nodePath from 'path';
import { DocWeaverSettings, SUPPORTED_EXTENSIONS, SupportedExtension } from './types';
import { Importer } from './importer';

export class WatchScheduler {
	private timer: number | null = null;
	private running = false;

	constructor(
		private importer: Importer,
		public settings: DocWeaverSettings,
		private seen: Set<string>,
		private onSeenUpdated: () => Promise<void>,
	) {}

	start(): void {
		this.stop();
		const folders = this.settings.watchFolders.filter(f => f.trim());
		if (this.settings.watchIntervalMin <= 0 || folders.length === 0) return;

		const ms = this.settings.watchIntervalMin * 60 * 1000;
		this.tick(); // immediate first scan
		this.timer = window.setInterval(() => this.tick(), ms);
	}

	stop(): void {
		if (this.timer !== null) {
			window.clearInterval(this.timer);
			this.timer = null;
		}
	}

	restart(): void {
		this.stop();
		this.start();
	}

	getSeenFiles(): string[] {
		return Array.from(this.seen);
	}

	private async tick(): Promise<void> {
		if (this.running) return; // skip overlapping scans
		this.running = true;
		try {
			for (const folder of this.settings.watchFolders) {
				const trimmed = folder.trim();
				if (!trimmed) continue;
				try {
					await this.scanFolder(trimmed);
				} catch (err) {
					console.error(`Doc Weaver watch: error scanning "${trimmed}"`, err);
				}
			}
		} finally {
			this.running = false;
		}
	}

	private async scanFolder(folderPath: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
		} catch {
			return; // folder missing or no permission
		}

		for (const entry of entries) {
			const fullPath = nodePath.join(folderPath, entry.name);

			if (entry.isDirectory()) {
				if (this.settings.watchSubfolders) {
					await this.scanFolder(fullPath);
				}
				continue;
			}

			if (!entry.isFile()) continue;

			const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
			if (!SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension)) continue;

			let mtime: number;
			try {
				mtime = (await fs.promises.stat(fullPath)).mtimeMs;
			} catch {
				continue;
			}

			// PRD: track by "filename + mtime" to detect new/modified files
			const key = `${entry.name}:${mtime}`;
			if (this.seen.has(key)) continue;

			await this.processFile(fullPath, entry.name, key);
		}
	}

	private async processFile(filePath: string, filename: string, seenKey: string): Promise<void> {
		try {
			const buffer = await fs.promises.readFile(filePath);
			const file = new File([buffer], filename);
			const result = await this.importer.importSingleFile(file, { skipOpen: false });

			if (result.success) {
				this.seen.add(seenKey);
				await this.onSeenUpdated();
				await this.handleOriginal(filePath);
			}
		} catch (err) {
			console.error(`Doc Weaver watch: failed to process "${filename}"`, err);
		}
	}

	private async handleOriginal(filePath: string): Promise<void> {
		try {
			switch (this.settings.afterImport) {
				case 'delete':
					await fs.promises.unlink(filePath);
					break;
				case 'archive': {
					const archiveDir = this.settings.archiveFolder.trim();
					if (!archiveDir) break;
					await fs.promises.mkdir(archiveDir, { recursive: true });
					const dest = nodePath.join(archiveDir, nodePath.basename(filePath));
					// If a file with the same name already exists in archive, add timestamp
					const finalDest = await fs.promises.access(dest).then(() => {
						const ts = Date.now();
						const ext = nodePath.extname(dest);
						const base = dest.slice(0, -ext.length);
						return `${base}_${ts}${ext}`;
					}).catch(() => dest);
					await fs.promises.rename(filePath, finalDest);
					break;
				}
				case 'keep':
					break;
			}
		} catch (err) {
			console.error(`Doc Weaver watch: failed to handle original "${filePath}"`, err);
		}
	}
}
