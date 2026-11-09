/**
 * Sprache auf dem Server (nur für Node-Code – liest Umgebungsvariablen).
 *
 * - `DEFAULT_LANGUAGE` bestimmt die Sprache von Logs, KI-Texten und allem ohne Anfrage-Kontext.
 * - Antworten auf API-Anfragen richten sich nach dem `Accept-Language`-Header der Weboberfläche.
 */
import {
  DEFAULT_LOCALE, LOCALES, LocalizedError, getTranslator, localeFromHeader, matchLocale, setMessageLocale,
  type LocaleCode, type MessageKey, type Params, type Translator,
} from './index.ts';

export const serverLocale: LocaleCode = matchLocale(process.env.DEFAULT_LANGUAGE) ?? DEFAULT_LOCALE;
setMessageLocale(serverLocale);

/** Übersetzer in der Server-Sprache – für Logs. */
export const t: Translator = getTranslator(serverLocale);

/** Übersetzer in der Sprache, die der Client per Accept-Language angefragt hat. */
export const requestT = (req: { headers: { 'accept-language'?: string | string[] } }): Translator => {
  const h = req.headers['accept-language'];
  return getTranslator(localeFromHeader(Array.isArray(h) ? h.join(',') : h, serverLocale));
};

/** Eine unbekannte DEFAULT_LANGUAGE nicht stillschweigend ignorieren. Gibt die Warnung zurück oder null. */
export function languageWarning(): string | null {
  const value = process.env.DEFAULT_LANGUAGE?.trim();
  if (!value || matchLocale(value)) return null;
  return t('log.unknownLanguage', { value, available: LOCALES.map((l) => l.code).join(', '), used: serverLocale });
}

/** Fehler mit HTTP-Status; die Meldung wird beim Antworten in der Sprache des Clients ausgegeben. */
export class HttpError extends LocalizedError {
  constructor(status: number, init: MessageKey | { raw: string }, params?: Params) {
    super(typeof init === 'string' ? { key: init, params } : init.raw, status);
  }
}

/** Kurzform: `throw`-Ausdruck für Stellen, die `never` zurückgeben sollen. */
export function fail(status: number, key: MessageKey, params?: Params): never {
  throw new HttpError(status, key, params);
}
