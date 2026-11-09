/**
 * Mehrsprachigkeit – geteilt zwischen Server und Weboberfläche, ohne Abhängigkeiten.
 *
 * Eine Sprache ist ein Ordner unter `locales/<code>/`, der ein Objekt vom Typ `Messages` exportiert.
 * Neue Sprache hinzufügen: siehe docs/I18N.md.
 */
import { catalogs, DEFAULT_LOCALE, FALLBACK_LOCALE, type LocaleCode } from './locales/index.ts';
import type { MessageKey, MessageValue, Params } from './types.ts';

export type { LocaleCode, MessageKey, MessageValue, Params };
export { DEFAULT_LOCALE, FALLBACK_LOCALE, catalogs };
export type { Messages, PluralForms } from './types.ts';

export interface LocaleInfo {
  code: LocaleCode;
  /** Eigenbezeichnung, z. B. „Deutsch“ – wird so im Sprachwähler angezeigt. */
  name: string;
  /** BCP-47-Tag für Intl (Datum, Zahlen, Plural). */
  intl: string;
}

export const LOCALES: LocaleInfo[] = (Object.keys(catalogs) as LocaleCode[]).map((code) => ({
  code,
  name: catalogs[code].meta.name,
  intl: catalogs[code].meta.intl,
}));

export const isLocale = (v: unknown): v is LocaleCode => typeof v === 'string' && Object.hasOwn(catalogs, v);

/**
 * Wählt aus Sprach-Tags (z. B. `navigator.languages` oder ein geparster Accept-Language-Header)
 * die erste unterstützte Sprache. „en-US“ passt auf „en“. Ohne Treffer: `undefined`.
 */
export function matchLocale(tags: readonly string[] | string | null | undefined): LocaleCode | undefined {
  const list = typeof tags === 'string' ? [tags] : (tags ?? []);
  for (const raw of list) {
    const tag = raw.trim().toLowerCase().replace('_', '-');
    if (!tag || tag === '*') continue;
    if (isLocale(tag)) return tag;
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return undefined;
}

/** Sprach-Tags eines Accept-Language-Headers, nach Gewichtung (q) sortiert. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((x) => x.tag && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((x) => x.tag);
}

/** Sprache aus einem Accept-Language-Header; ohne Treffer `fallback`. */
export function localeFromHeader(header: string | null | undefined, fallback: LocaleCode = DEFAULT_LOCALE): LocaleCode {
  return matchLocale(parseAcceptLanguage(header)) ?? fallback;
}

// ───────────── Übersetzen ─────────────

function lookup(tree: unknown, key: string): MessageValue | undefined {
  let node = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && typeof (node as { other?: unknown }).other === 'string') return node as MessageValue;
  return undefined;
}

function interpolate(text: string, params: Params | undefined) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));
}

export type Translator = ((key: MessageKey, params?: Params) => string) & { locale: LocaleCode };

const translators = new Map<LocaleCode, Translator>();

/**
 * Übersetzer für eine Sprache. `{name}` wird durch `params.name` ersetzt. Ist der Wert ein Plural-Objekt
 * (`{ one, other }`), entscheidet `params.count` anhand der Regeln der Sprache. Fehlt ein Schlüssel,
 * greift `FALLBACK_LOCALE`, zuletzt der Schlüssel selbst.
 */
export function getTranslator(locale: LocaleCode): Translator {
  const cached = translators.get(locale);
  if (cached) return cached;
  const rules = new Intl.PluralRules(catalogs[locale].meta.intl);
  const fn = ((key: MessageKey, params?: Params) => {
    const value = lookup(catalogs[locale], key) ?? lookup(catalogs[FALLBACK_LOCALE], key);
    if (value === undefined) return key;
    if (typeof value === 'string') return interpolate(value, params);
    const count = Number(params?.count);
    if (!Number.isFinite(count)) return interpolate(value.other, params);
    // Ein ausdrücklich angegebenes „zero“ gewinnt (z. B. „keine Nodes“), sonst entscheiden die Plural-Regeln der Sprache
    const text = (count === 0 && value.zero) || value[rules.select(count) as keyof typeof value] || value.other;
    return interpolate(text, params);
  }) as Translator;
  fn.locale = locale;
  translators.set(locale, fn);
  return fn;
}

// ───────────── Meldungen, die in der Datenbank landen ─────────────
//
// Fehlertexte aus Hintergrundläufen (Sync, Health-Abfrage, KI) werden gespeichert und erst Tage später
// angezeigt – vielleicht in einer anderen Sprache. Statt fertigem Text steht dort `i18n:{"k":…,"p":…}`;
// die Oberfläche übersetzt beim Anzeigen. Texte ohne dieses Präfix (z. B. Meldungen von n8n selbst
// oder Einträge aus älteren Versionen) werden unverändert angezeigt.

const PACKED = 'i18n:';

export function packMessage(key: MessageKey, params?: Params): string {
  return PACKED + JSON.stringify(params && Object.keys(params).length ? { k: key, p: params } : { k: key });
}

export function unpackMessage(text: string | null | undefined): { key: MessageKey; params?: Params } | null {
  if (!text?.startsWith(PACKED)) return null;
  try {
    const j = JSON.parse(text.slice(PACKED.length)) as { k?: unknown; p?: Params };
    return typeof j.k === 'string' ? { key: j.k as MessageKey, params: j.p } : null;
  } catch {
    return null;
  }
}

/** Gespeicherte Meldung in der gewünschten Sprache; normale Texte bleiben, wie sie sind. */
export function renderMessage(text: string | null | undefined, t: Translator): string {
  const packed = unpackMessage(text);
  return packed ? t(packed.key, packed.params) : (text ?? '');
}

/**
 * Fehler mit übersetzbarer Meldung. `message` ist bereits in der Server-Sprache formuliert (für Logs);
 * `key`/`params` erlauben, sie für den Empfänger neu zu übersetzen oder zu speichern. Ohne `key`
 * (z. B. wörtliche Antwort von n8n) bleibt der Text, wie er ist.
 */
let messageLocale: LocaleCode = DEFAULT_LOCALE;
/** Sprache der `message` von LocalizedError (für Logs). Der Server setzt hier seine DEFAULT_LANGUAGE. */
export const setMessageLocale = (locale: LocaleCode) => void (messageLocale = locale);

export class LocalizedError extends Error {
  key?: MessageKey;
  params?: Params;
  status: number;
  constructor(init: string | { key: MessageKey; params?: Params }, status = 0) {
    super(typeof init === 'string' ? init : getTranslator(messageLocale)(init.key, init.params));
    if (typeof init !== 'string') {
      this.key = init.key;
      this.params = init.params;
    }
    this.status = status;
  }
  /** Meldung in `t`s Sprache. */
  render(t: Translator) {
    return this.key ? t(this.key, this.params) : this.message;
  }
  /** Zum Speichern in der Datenbank (siehe oben). */
  pack() {
    return this.key ? packMessage(this.key, this.params) : this.message;
  }
}

/** Zum Speichern: übersetzbare Fehler als `i18n:…`, alles andere als Text (auf `max` Zeichen gekürzt – `i18n:…` nie, es wäre danach ungültig). */
export function packError(e: unknown, max = 500): string {
  if (e instanceof LocalizedError && e.key) return e.pack();
  return (e instanceof Error ? e.message : String(e)).slice(0, max);
}

/** Für Antworten an einen Client: Meldung in dessen Sprache. */
export const renderError = (e: unknown, t: Translator): string => (e instanceof LocalizedError ? e.render(t) : e instanceof Error ? e.message : String(e));
