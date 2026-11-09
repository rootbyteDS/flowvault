import type { de } from './locales/de/index.ts';

export type Params = Record<string, string | number>;

/** Pluralformen nach CLDR. `other` ist Pflicht; welche weiteren Formen eine Sprache braucht, bestimmt sie selbst. */
export interface PluralForms {
  other: string;
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
}

export type MessageValue = string | PluralForms;

/** Die Struktur der deutschen Texte, wobei jedes Plural-Objekt beliebige Pluralformen haben darf. */
type Widen<T> = T extends string ? string : T extends { other: string } ? PluralForms : { [K in keyof T]: Widen<T[K]> };

/** Jede Sprache muss genau diese Schlüssel liefern – fehlende oder überzählige meldet `npm run typecheck`. */
export type Messages = Widen<typeof de>;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Alle gültigen Schlüssel, z. B. `'dashboard.title'`. `meta` zählt nicht. */
export type MessageKey = Exclude<Leaves<typeof de>, `meta.${string}`>;
