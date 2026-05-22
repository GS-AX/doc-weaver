import { App, PluginSettingTab, Setting } from 'obsidian';
import DocWeaverPlugin from './main';
import { t } from './i18n';

export class DocWeaverSettingTab extends PluginSettingTab {
	plugin: DocWeaverPlugin;

	constructor(app: App, plugin: DocWeaverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: t('SETTINGS_TITLE') });

		this.renderOutputSection();
		this.renderWatchSection();
		this.renderAdvancedSection();
	}

	private renderOutputSection(): void {
		const { containerEl } = this;
		containerEl.createEl('h3', { text: t('SETTINGS_SECTION_OUTPUT') });

		new Setting(containerEl)
			.setName(t('DEST_FOLDER'))
			.setDesc(t('DEST_FOLDER_DESC'))
			.addText(text =>
				text
					.setPlaceholder('Imported')
					.setValue(this.plugin.settings.destinationFolder)
					.onChange(async v => {
						this.plugin.settings.destinationFolder = v || 'Imported';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('ASSET_SUBFOLDER'))
			.setDesc(t('ASSET_SUBFOLDER_DESC'))
			.addText(text =>
				text
					.setPlaceholder('_assets')
					.setValue(this.plugin.settings.assetSubfolder)
					.onChange(async v => {
						this.plugin.settings.assetSubfolder = v || '_assets';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('FILENAME_COLLISION'))
			.setDesc(t('FILENAME_COLLISION_DESC'))
			.addDropdown(drop =>
				drop
					.addOption('skip', t('COLLISION_SKIP'))
					.addOption('overwrite', t('COLLISION_OVERWRITE'))
					.addOption('number', t('COLLISION_NUMBER'))
					.setValue(this.plugin.settings.filenameCollision)
					.onChange(async v => {
						this.plugin.settings.filenameCollision = v as 'skip' | 'overwrite' | 'number';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('PPTX_OUTPUT'))
			.setDesc(t('PPTX_OUTPUT_DESC'))
			.addDropdown(drop =>
				drop
					.addOption('single', t('PPTX_SINGLE'))
					.addOption('per-slide', t('PPTX_PER_SLIDE'))
					.setValue(this.plugin.settings.pptxOutput)
					.onChange(async v => {
						this.plugin.settings.pptxOutput = v as 'single' | 'per-slide';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('WIKILINKS'))
			.setDesc(t('WIKILINKS_DESC'))
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.useWikilinks).onChange(async v => {
					this.plugin.settings.useWikilinks = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t('OPEN_AFTER_IMPORT'))
			.setDesc(t('OPEN_AFTER_IMPORT_DESC'))
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.openAfterImport).onChange(async v => {
					this.plugin.settings.openAfterImport = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderWatchSection(): void {
		const { containerEl } = this;
		containerEl.createEl('h3', { text: t('SETTINGS_SECTION_WATCH') });

		// Watch folders list
		const watchDesc = containerEl.createEl('p', {
			text: t('WATCH_FOLDERS_DESC'),
			cls: 'setting-item-description',
		});
		watchDesc.style.marginBottom = '8px';

		const listEl = containerEl.createDiv();
		const renderWatchList = () => {
			listEl.empty();
			this.plugin.settings.watchFolders.forEach((folder, idx) => {
				new Setting(listEl)
					.addText(text =>
						text
							.setPlaceholder(t('WATCH_FOLDER_PLACEHOLDER'))
							.setValue(folder)
							.onChange(async v => {
								this.plugin.settings.watchFolders[idx] = v;
								await this.plugin.saveSettings();
							}),
					)
					.addButton(btn =>
						btn
							.setButtonText(t('REMOVE'))
							.setWarning()
							.onClick(async () => {
								this.plugin.settings.watchFolders.splice(idx, 1);
								await this.plugin.saveSettings();
								renderWatchList();
							}),
					);
			});
		};
		renderWatchList();

		new Setting(containerEl).addButton(btn =>
			btn
				.setButtonText(t('ADD_WATCH_FOLDER'))
				.setCta()
				.onClick(async () => {
					this.plugin.settings.watchFolders.push('');
					await this.plugin.saveSettings();
					renderWatchList();
				}),
		);

		new Setting(containerEl)
			.setName(t('WATCH_INTERVAL'))
			.setDesc(t('WATCH_INTERVAL_DESC'))
			.addText(text =>
				text
					.setPlaceholder('5')
					.setValue(String(this.plugin.settings.watchIntervalMin))
					.onChange(async v => {
						const n = parseInt(v);
						this.plugin.settings.watchIntervalMin = isNaN(n) ? 5 : Math.max(0, n);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('WATCH_SUBFOLDERS'))
			.setDesc(t('WATCH_SUBFOLDERS_DESC'))
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.watchSubfolders).onChange(async v => {
					this.plugin.settings.watchSubfolders = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t('AFTER_IMPORT'))
			.setDesc(t('AFTER_IMPORT_DESC'))
			.addDropdown(drop =>
				drop
					.addOption('archive', t('AFTER_ARCHIVE'))
					.addOption('delete', t('AFTER_DELETE'))
					.addOption('keep', t('AFTER_KEEP'))
					.setValue(this.plugin.settings.afterImport)
					.onChange(async v => {
						this.plugin.settings.afterImport = v as 'archive' | 'delete' | 'keep';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('ARCHIVE_FOLDER'))
			.setDesc(t('ARCHIVE_FOLDER_DESC'))
			.addText(text =>
				text
					.setPlaceholder(t('ARCHIVE_FOLDER_PLACEHOLDER'))
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async v => {
						this.plugin.settings.archiveFolder = v;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderAdvancedSection(): void {
		const { containerEl } = this;
		containerEl.createEl('h3', { text: t('SETTINGS_SECTION_ADVANCED') });

		new Setting(containerEl)
			.setName(t('SHOW_HWP_BETA'))
			.setDesc(t('SHOW_HWP_BETA_DESC'))
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.showHwpBeta).onChange(async v => {
					this.plugin.settings.showHwpBeta = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t('LANGUAGE'))
			.setDesc(t('LANGUAGE_DESC'))
			.addDropdown(drop =>
				drop
					.addOption('auto', t('LANG_AUTO'))
					.addOption('en', 'English')
					.addOption('ko', '한국어')
					.addOption('ja', '日本語')
					.addOption('zh', '中文')
					.setValue(this.plugin.settings.language)
					.onChange(async v => {
						this.plugin.settings.language = v as DocWeaverPlugin['settings']['language'];
						await this.plugin.saveSettings();
						// Re-render settings with new locale
						this.display();
					}),
			);
	}
}
