export const en = {
	// Commands
	CMD_IMPORT_FILE: 'Import file…',

	// Settings headings
	SETTINGS_TITLE: 'Doc Weaver',
	SETTINGS_SECTION_OUTPUT: 'Output',
	SETTINGS_SECTION_WATCH: 'Watch Folder',
	SETTINGS_SECTION_ADVANCED: 'Advanced',

	// Output settings
	DEST_FOLDER: 'Destination folder',
	DEST_FOLDER_DESC: 'Vault folder where converted notes are saved',
	ASSET_SUBFOLDER: 'Asset subfolder',
	ASSET_SUBFOLDER_DESC: 'Sub-path inside destination folder for extracted images',
	FILENAME_COLLISION: 'Filename collision',
	FILENAME_COLLISION_DESC: 'What to do when a converted note already exists',
	COLLISION_SKIP: 'Skip',
	COLLISION_OVERWRITE: 'Overwrite',
	COLLISION_NUMBER: 'Add number suffix',
	PPTX_OUTPUT: 'PowerPoint output',
	PPTX_OUTPUT_DESC: 'How to structure converted PowerPoint files',
	PPTX_SINGLE: 'Single note',
	PPTX_PER_SLIDE: 'Per-slide notes',
	WIKILINKS: 'Use wikilinks for images',
	WIKILINKS_DESC: 'Use ![[...]] instead of ![](...) for embedded images',
	OPEN_AFTER_IMPORT: 'Open after import',
	OPEN_AFTER_IMPORT_DESC: 'Open the created note after conversion (skipped for bulk import)',

	// Watch folder settings
	WATCH_FOLDERS: 'Watch folders',
	WATCH_FOLDERS_DESC: 'OS paths to monitor for new files to auto-import',
	WATCH_INTERVAL: 'Watch interval (minutes)',
	WATCH_INTERVAL_DESC: 'How often to check watch folders. Set to 0 to disable.',
	WATCH_SUBFOLDERS: 'Watch subfolders',
	WATCH_SUBFOLDERS_DESC: 'Recursively watch inbox subfolders',
	AFTER_IMPORT: 'After import',
	AFTER_IMPORT_DESC: 'What to do with the original file after successful conversion',
	AFTER_ARCHIVE: 'Archive',
	AFTER_DELETE: 'Delete',
	AFTER_KEEP: 'Keep in place',
	ARCHIVE_FOLDER: 'Archive folder',
	ARCHIVE_FOLDER_DESC: 'OS path to move original files after conversion',
	ADD_WATCH_FOLDER: 'Add folder',
	REMOVE: 'Remove',
	WATCH_FOLDER_PLACEHOLDER: '/path/to/inbox',
	ARCHIVE_FOLDER_PLACEHOLDER: '/path/to/archive',

	// Advanced settings
	SHOW_HWP_BETA: 'Show HWP beta features',
	SHOW_HWP_BETA_DESC: 'Enable HWP/HWPx conversion (beta — off by default, conversion quality may be limited)',
	LANGUAGE: 'Language',
	LANGUAGE_DESC: 'Plugin UI language',
	LANG_AUTO: 'Auto (follow system)',

	// File picker
	FILE_PICKER_LABEL: 'Documents (Word, PDF, PowerPoint, Excel, HWP, Text)',

	// Notices — use {placeholder} for dynamic values
	NOTICE_SUCCESS: '✅ {name} → {dest} ({stats})',
	NOTICE_SKIP: '⏭️ {name} — already exists, skipped',
	NOTICE_ERROR: '❌ {name} — {error}',
	NOTICE_BETA_WARNING: '⚠️ {name} — limited conversion [beta]',
	NOTICE_UNSUPPORTED: 'Unsupported file type: {ext}',
	NOTICE_BULK_SUMMARY: '✅ {success} file(s) imported ({warn} warning(s)) → {dest}',

	// Stats string fragments
	STAT_HEADINGS_ONE: '1 heading',
	STAT_HEADINGS: '{n} headings',
	STAT_IMAGES_ONE: '1 image',
	STAT_IMAGES: '{n} images',
	STAT_TABLES_ONE: '1 table',
	STAT_TABLES: '{n} tables',
};

export type Translations = typeof en;
