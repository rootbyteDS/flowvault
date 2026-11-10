import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { checkChangelog, notesForTag, parseChangelog, releaseNotes } from './changelog.ts';

const sample = `# Changelog

Einleitung.

## [Unreleased]

### Behoben
- Etwas Neues

## [0.3.0] – 2026-11-10

### Hinzugefügt
- Erste Funktion

## [0.2.1] - 2026-10-01

- Älterer Eintrag

[Unreleased]: https://github.com/example/repo/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/example/repo/releases/tag/v0.3.0
`;

test('parses unreleased changes and releases without link definitions', () => {
  const log = parseChangelog(sample);
  assert.equal(log.unreleased, '### Behoben\n- Etwas Neues');
  assert.deepEqual(log.releases.map((r) => [r.version, r.date]), [['0.3.0', '2026-11-10'], ['0.2.1', '2026-10-01']]);
  assert.equal(log.releases[1]!.body, '- Älterer Eintrag');
  assert.equal(releaseNotes(sample, '0.3.0'), '### Hinzugefügt\n- Erste Funktion');
});

test('rejects malformed changelogs', () => {
  const head = '# Changelog\n\n## [Unreleased]\n\n';
  assert.throws(() => parseChangelog('# Changelog\n\n## [0.1.0] – 2026-01-01\n- x\n'), /Unreleased/);
  assert.throws(() => parseChangelog(head + '## [0.1.0]\n- x\n'), /Datum/);
  assert.throws(() => parseChangelog(head + '## [0.1.0] – 2026-02-30\n- x\n'), /Datum/);
  assert.throws(() => parseChangelog(head + '## [v0.1.0] – 2026-01-01\n- x\n'), /Projektversion/);
  assert.throws(() => parseChangelog(head + '## [0.1.0] – 2026-01-01\n- x\n## [0.2.0] – 2026-01-02\n- y\n'), /absteigend/);
  assert.throws(() => parseChangelog(head + '## [0.1.0] – 2026-01-01\n- x\n## [0.1.0] – 2026-01-01\n- y\n'), /eindeutig/);
  assert.throws(() => parseChangelog(head + '## Version 0.1.0\n'), /Ungültige Überschrift/);
});

test('release notes require a non-empty section', () => {
  const empty = '## [Unreleased]\n\n## [0.3.0] – 2026-11-10\n\n';
  assert.throws(() => releaseNotes(empty, '0.3.0'), /leer/);
  assert.throws(() => releaseNotes(sample, '0.4.0'), /keinen Abschnitt/);
});

test('release tags must match the project version and the changelog', () => {
  assert.equal(notesForTag(sample, 'v0.3.0', '0.3.0'), '### Hinzugefügt\n- Erste Funktion');
  assert.throws(() => notesForTag(sample, '0.3.0', '0.3.0'), /vX\.Y\.Z/);
  assert.throws(() => notesForTag(sample, 'v0.3.0', '0.3.1'), /passt nicht/);
  assert.throws(() => checkChangelog(sample, '0.2.9'), /über der Projektversion/);
  assert.equal(checkChangelog(sample, '0.3.4').length, 2);
});

test('the project changelog is valid', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  checkChangelog(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), pkg.version);
});
