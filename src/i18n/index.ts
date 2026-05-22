import { en, Translations } from './en';
import { ko } from './ko';
import { ja } from './ja';
import { zh } from './zh';

const locales: Record<string, Translations> = { en, ko, ja, zh };
let _locale: Translations = en;

export function setLocale(lang: string): void {
	_locale = locales[lang] ?? en;
}

export function t(key: keyof Translations): string {
	return (_locale[key] ?? en[key]) as string;
}

export function tFormat(key: keyof Translations, vars: Record<string, string | number>): string {
	let s = t(key);
	for (const [k, v] of Object.entries(vars)) {
		s = s.replace(`{${k}}`, String(v));
	}
	return s;
}

export function formatStats(headings: number, images: number, tables: number): string {
	const parts: string[] = [];
	if (headings > 0) parts.push(headings === 1 ? t('STAT_HEADINGS_ONE') : tFormat('STAT_HEADINGS', { n: headings }));
	if (images > 0) parts.push(images === 1 ? t('STAT_IMAGES_ONE') : tFormat('STAT_IMAGES', { n: images }));
	if (tables > 0) parts.push(tables === 1 ? t('STAT_TABLES_ONE') : tFormat('STAT_TABLES', { n: tables }));
	return parts.join(', ');
}
