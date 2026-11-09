/**
 * Mehrsprachigkeit der Oberfläche. Die Texte liegen in shared/i18n/locales/<sprache>/ (Anleitung: docs/I18N.md).
 *
 *   import { t } from './i18n.tsx';
 *   t('dashboard.syncAll');                     // einfacher Text
 *   t('workflows.count', { count: 3 });         // {count}-Platzhalter bzw. Plural
 *   rich('auth.setupCodeHint', { code: (c) => <code>{c}</code> });   // Text mit <code>…</code>
 *
 * `t` liest die aktive Sprache aus einer Variable, nicht aus dem React-State. Das geht, weil ein Sprachwechsel
 * die gesamte Oberfläche neu aufbaut (siehe I18nProvider) – so brauchen auch Hilfsfunktionen und Konstanten
 * keinen Hook.
 */
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE, LOCALES, getTranslator, isLocale, matchLocale, renderMessage, type LocaleCode, type LocaleInfo, type MessageKey, type Params,
} from '../../shared/i18n/index.ts';

export type { LocaleCode, LocaleInfo, MessageKey, Params };

const STORAGE_KEY = 'fv:lang';

function stored(): LocaleCode | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : undefined;
  } catch {
    return undefined; // Speicher gesperrt (z. B. privates Fenster)
  }
}

const browser = () => matchLocale(typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

let active: LocaleCode = stored() ?? browser() ?? DEFAULT_LOCALE;
let translate = getTranslator(active);

function activate(locale: LocaleCode) {
  active = locale;
  translate = getTranslator(locale);
  document.documentElement.lang = locale;
}

/** Aktive Sprache, z. B. für `Accept-Language` und Intl-Formatierung. */
export const currentLocale = () => active;

/** BCP-47-Tag der aktiven Sprache für `Intl` und `toLocaleString`. */
export const intlLocale = () => LOCALES.find((l) => l.code === active)?.intl ?? active;

export const t = (key: MessageKey, params?: Params) => translate(key, params);

/** Übersetzt eine vom Server gespeicherte Meldung (`i18n:…`) oder gibt normalen Text unverändert zurück. */
export const message = (text: string | null | undefined) => renderMessage(text, translate);

type Tags = Record<string, (children: string) => ReactNode>;

function renderTags(text: string, tags: Tags): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const render = tags[m[1]!];
    out.push(<Fragment key={out.length}>{render ? render(m[2]!) : m[2]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * Text mit einfachen Tags, z. B. `Siehe <code>docker logs</code>.` Jedes Tag braucht eine Funktion in `tags`;
 * unbekannte Tags erscheinen als reiner Text. Tags dürfen nicht verschachtelt werden.
 */
export function rich(key: MessageKey, tags: Tags, params?: Params): ReactNode {
  return renderTags(translate(key, params), tags);
}

const defaultTags: Tags = {
  b: (c) => <b>{c}</b>,
  code: (c) => <code className="font-mono text-text">{c}</code>,
};

/** Erklärtexte: Absätze durch eine Leerzeile getrennt, darin `<b>…</b>` und `<code>…</code>` (für InfoTip). */
export function paragraphs(key: MessageKey, params?: Params): ReactNode {
  return translate(key, params)
    .split('\n\n')
    .map((p, i) => <p key={i}>{renderTags(p, defaultTags)}</p>);
}

// ───────────── React-Anbindung ─────────────

interface I18nContext {
  locale: LocaleCode;
  locales: LocaleInfo[];
  /** Speichert die Wahl dieses Browsers und baut die Oberfläche in der neuen Sprache neu auf. */
  setLocale: (locale: LocaleCode) => void;
  /** Vom Server (`DEFAULT_LANGUAGE`) – gilt nur, wenn weder Wahl noch Browser eine unterstützte Sprache nennen. */
  setServerDefault: (locale: LocaleCode | undefined) => void;
}

const Ctx = createContext<I18nContext>({ locale: active, locales: LOCALES, setLocale: () => {}, setServerDefault: () => {} });
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState(stored);
  const [serverDefault, setServerDefault] = useState<LocaleCode>();
  const locale = choice ?? browser() ?? serverDefault ?? DEFAULT_LOCALE;
  // Vor dem Rendern der Kinder setzen: Sie lesen die Sprache über `t`
  if (locale !== active || document.documentElement.lang !== locale) activate(locale);

  const setLocale = useCallback((next: LocaleCode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setChoice(next);
  }, []);

  const value = useMemo(() => ({ locale, locales: LOCALES, setLocale, setServerDefault }), [locale, setLocale]);
  // key = Sprache: Ein Wechsel baut alles neu auf, damit auch Texte aus Hilfsfunktionen und Konstanten stimmen
  return (
    <Ctx.Provider value={value}>
      <Fragment key={locale}>{children}</Fragment>
    </Ctx.Provider>
  );
}
