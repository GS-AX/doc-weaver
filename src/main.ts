import { Plugin } from 'obsidian';
import { DocWeaverSettings, DEFAULT_SETTINGS } from './types';
import { DocWeaverSettingTab } from './settings';
import { Importer } from './importer';
import { setLocale, t } from './i18n';

export default class DocWeaverPlugin extends Plugin {
	settings: DocWeaverSettings;
	importer: Importer;

	async onload() {
		await this.loadSettings();
		this.applyLocale();

		this.importer = new Importer(this.app, this.settings);

		this.addCommand({
			id: 'import-file',
			name: t('CMD_IMPORT_FILE'),
			callback: () => this.importer.pickAndImport(),
		});

		this.addSettingTab(new DocWeaverSettingTab(this.app, this));

		console.log('Doc Weaver loaded');
	}

	onunload() {
		console.log('Doc Weaver unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.importer.settings = this.settings;
		this.applyLocale();
	}

	private applyLocale() {
		const lang =
			this.settings.language === 'auto'
				? (window.navigator.language ?? 'en').split('-')[0]
				: this.settings.language;
		setLocale(lang);
	}
}
