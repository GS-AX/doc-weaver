import { Plugin } from 'obsidian';
import { DocWeaverSettings, DEFAULT_SETTINGS } from './types';
import { DocWeaverSettingTab } from './settings';
import { Importer } from './importer';
import { DropHandler } from './dropHandler';
import { WatchScheduler } from './watchScheduler';
import { setLocale, t } from './i18n';

interface PluginData {
	settings: Partial<DocWeaverSettings>;
	watcherSeen: string[];
}

export default class DocWeaverPlugin extends Plugin {
	settings!: DocWeaverSettings;
	importer!: Importer;
	private watchScheduler!: WatchScheduler;

	async onload() {
		const data = await this.loadPluginData();

		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
		this.applyLocale();

		this.importer = new Importer(this.app, this.settings);
		new DropHandler(this.importer).register(this);

		this.watchScheduler = new WatchScheduler(
			this.importer,
			this.settings,
			new Set(data.watcherSeen),
			() => this.persistSeenFiles(),
		);
		this.watchScheduler.start();

		this.addCommand({
			id: 'import-file',
			name: t('CMD_IMPORT_FILE'),
			callback: () => this.importer.pickAndImport(),
		});

		this.addSettingTab(new DocWeaverSettingTab(this.app, this));
	}

	onunload() {
		this.watchScheduler.stop();
	}

	async loadSettings() {
		const data = await this.loadPluginData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
	}

	async saveSettings() {
		const data = await this.loadPluginData();
		await this.saveData({ ...data, settings: this.settings });

		this.importer.settings = this.settings;
		this.watchScheduler.settings = this.settings;
		this.watchScheduler.restart();
		this.applyLocale();
	}

	private async loadPluginData(): Promise<PluginData> {
		const raw = (await this.loadData()) ?? {};
		// Backwards-compat: old format stored settings flat at root
		const settings: Partial<DocWeaverSettings> = raw.settings ?? raw;
		const watcherSeen: string[] = raw.watcherSeen ?? [];
		return { settings, watcherSeen };
	}

	private async persistSeenFiles(): Promise<void> {
		const data = await this.loadPluginData();
		await this.saveData({ ...data, watcherSeen: this.watchScheduler.getSeenFiles() });
	}

	private applyLocale() {
		const lang =
			this.settings.language === 'auto'
				? (window.navigator.language ?? 'en').split('-')[0]
				: this.settings.language;
		setLocale(lang);
	}
}
