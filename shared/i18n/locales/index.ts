/**
 * Registry aller Sprachen. Eine neue Sprache braucht genau zwei Zeilen hier:
 * den Import und den Eintrag in `catalogs` (Anleitung: docs/I18N.md).
 */
import type { Messages } from '../types.ts';
import { de } from './de/index.ts';
import { en } from './en/index.ts';

export const catalogs = { de, en } satisfies Record<string, Messages>;

export type LocaleCode = keyof typeof catalogs;

/** Sprache, wenn weder Nutzerwahl noch Browser noch DEFAULT_LANGUAGE eine unterstützte nennen. */
export const DEFAULT_LOCALE: LocaleCode = 'de';

/** Aushilfe für einzelne Schlüssel, die eine Sprache (noch) nicht übersetzt. */
export const FALLBACK_LOCALE: LocaleCode = 'en';
