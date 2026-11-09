import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCALES, LocalizedError, catalogs, getTranslator, localeFromHeader, matchLocale, packError, packMessage, parseAcceptLanguage,
  renderMessage, unpackMessage, type LocaleCode,
} from './index.ts';

type Tree = { [k: string]: string | Tree };

/** Alle Blätter eines Katalogs als „pfad → Text“; ein Objekt mit `other` zählt als ein Plural-Blatt. */
function leaves(tree: unknown, prefix = '', out = new Map<string, string | Record<string, string>>()) {
  for (const [k, v] of Object.entries(tree as Tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(path, v);
    else if (typeof (v as Tree).other === 'string') out.set(path, v as Record<string, string>);
    else leaves(v, path, out);
  }
  return out;
}

const codes = Object.keys(catalogs) as LocaleCode[];
const reference = leaves(catalogs.de);
const texts = (v: string | Record<string, string>) => (typeof v === 'string' ? [v] : Object.values(v));
const placeholders = (v: string | Record<string, string>) =>
  [...new Set(texts(v).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))].sort();
const tags = (v: string | Record<string, string>) =>
  [...new Set(texts(v).flatMap((s) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]!)))].sort();

for (const code of codes) {
  const own = leaves(catalogs[code]);

  test(`${code}: hat genau die Schlüssel der Vorlage (de)`, () => {
    assert.deepEqual([...own.keys()].sort(), [...reference.keys()].sort());
  });

  test(`${code}: Platzhalter und Tags stimmen mit der Vorlage überein`, () => {
    for (const [key, value] of own) {
      const ref = reference.get(key)!;
      // Pluralformen dürfen den Zähler weglassen („ein Lauf“), sonst muss alles übereinstimmen
      const refPlaceholders = placeholders(ref).filter((p) => p !== 'count');
      const ownPlaceholders = placeholders(value).filter((p) => p !== 'count');
      assert.deepEqual(ownPlaceholders, refPlaceholders, `Platzhalter in ${key}`);
      assert.deepEqual(tags(value), tags(ref), `Tags in ${key}`);
    }
  });

  test(`${code}: keine leeren Texte, Pluralformen vollständig`, () => {
    const required = new Intl.PluralRules(catalogs[code].meta.intl).resolvedOptions().pluralCategories;
    for (const [key, value] of own) {
      for (const text of texts(value)) assert.ok(text.trim().length > 0, `leerer Text: ${key}`);
      if (typeof value !== 'string') for (const form of required) assert.ok(value[form], `${key}: Pluralform „${form}“ fehlt für ${code}`);
    }
  });

  test(`${code}: Name und Intl-Tag sind gültig`, () => {
    assert.ok(catalogs[code].meta.name.length > 0);
    assert.doesNotThrow(() => new Intl.DateTimeFormat(catalogs[code].meta.intl));
  });
}

test('alle Sprachen sind registriert', () => {
  assert.deepEqual(LOCALES.map((l) => l.code).sort(), [...codes].sort());
});

test('Sprachwahl: exakter Treffer, Basissprache, Gewichtung, unbekannt', () => {
  assert.equal(matchLocale('en'), 'en');
  assert.equal(matchLocale('en-US'), 'en');
  assert.equal(matchLocale('DE_at'), 'de');
  assert.equal(matchLocale(['fr-FR', 'en-GB']), 'en');
  assert.equal(matchLocale('xx'), undefined);
  assert.equal(matchLocale(undefined), undefined);
  assert.deepEqual(parseAcceptLanguage('fr;q=0.4, en-GB;q=0.9, de;q=0.8, *;q=0.1'), ['en-GB', 'de', 'fr', '*']);
  assert.equal(localeFromHeader('fr;q=0.9, de;q=0.8'), 'de');
  assert.equal(localeFromHeader('xx', 'en'), 'en');
  assert.equal(localeFromHeader(undefined), 'de');
});

test('Übersetzer: Platzhalter, Plural, fehlender Schlüssel', () => {
  const en = getTranslator('en');
  const de = getTranslator('de');
  assert.equal(en('workflows.count', { count: 1 }), '1 workflow');
  assert.equal(en('workflows.count', { count: 3 }), '3 workflows');
  assert.equal(de('workflows.count', { count: 1 }), '1 Workflow');
  assert.equal(de('workflows.count', { count: 0 }), '0 Workflows');
  assert.equal(en('errors.auth.throttled', { seconds: 12 }), 'Too many attempts – please wait 12s');
  // Unbekannte Platzhalter bleiben stehen, statt „undefined“ auszugeben
  assert.equal(en('errors.auth.throttled'), 'Too many attempts – please wait {seconds}s');
  assert.equal(en('does.not.exist' as never), 'does.not.exist');
});

test('gespeicherte Meldungen: Hin- und Rückweg, normale Texte bleiben', () => {
  const packed = packMessage('errors.n8n.unreachable', { reason: 'ECONNREFUSED' });
  assert.deepEqual(unpackMessage(packed), { key: 'errors.n8n.unreachable', params: { reason: 'ECONNREFUSED' } });
  assert.equal(renderMessage(packed, getTranslator('en')), 'Instance not reachable (ECONNREFUSED)');
  assert.equal(renderMessage(packed, getTranslator('de')), 'Instanz nicht erreichbar (ECONNREFUSED)');
  assert.equal(renderMessage('HTTP 502', getTranslator('en')), 'HTTP 502');
  assert.equal(renderMessage(null, getTranslator('en')), '');
  // Defektes Präfix wird als Text behandelt, nicht als Absturz
  assert.equal(unpackMessage('i18n:{kaputt'), null);
  assert.equal(renderMessage('i18n:{kaputt', getTranslator('en')), 'i18n:{kaputt');
});

test('LocalizedError: Text für Logs, Übersetzung für Empfänger, Speicherform', () => {
  const coded = new LocalizedError({ key: 'errors.instance.notFound' }, 404);
  assert.equal(coded.status, 404);
  assert.equal(coded.render(getTranslator('en')), 'Instance not found');
  assert.equal(packError(coded), packMessage('errors.instance.notFound'));
  // Wörtliche Fremdmeldungen bleiben unverändert und werden nur gekürzt, nie die gepackte Form
  const raw = new LocalizedError('x'.repeat(600));
  assert.equal(packError(raw, 10), 'x'.repeat(10));
  assert.equal(packError(new Error('boom')), 'boom');
});
