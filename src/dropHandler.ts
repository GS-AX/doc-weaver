import { Plugin } from 'obsidian';
import { Importer } from './importer';
import { SUPPORTED_EXTENSIONS, SupportedExtension } from './types';

export class DropHandler {
	constructor(private importer: Importer) {}

	register(plugin: Plugin): void {
		// Capture phase so we intercept before Obsidian's own drop handler
		plugin.registerDomEvent(document, 'drop', (e: DragEvent) => this.onDrop(e), true);
	}

	private onDrop(event: DragEvent): void {
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length === 0) return;

		const supported = files.filter(f => {
			const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
			return SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension);
		});

		// No supported files → pass through to Obsidian's default handler
		if (supported.length === 0) return;

		event.preventDefault();
		event.stopPropagation();

		// Fire-and-forget; importFiles posts its own notices on completion
		void this.importer.importFiles(supported).catch(err =>
			console.error('Doc Weaver: drop import failed', err),
		);
	}
}
