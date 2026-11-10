import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVersions, versionParts } from './version.ts';

/**
 * CHANGELOG.md im Format „Keep a Changelog“:
 *   ## [Unreleased]
 *   ## [0.3.0] – 2026-11-10
 * Link-Definitionen am Dateiende ([0.3.0]: https://…) gehören zu keinem Abschnitt.
 */
export type Release = { version: string; date: string; body: string };
export type Changelog = { unreleased: string; releases: Release[] };

const HEADING = /^## \[([^\]]+)\](?:\s+[–-]\s+(\S+))?\s*$/;
const LINK_DEFINITION = /^\[[^\]]+\]:\s+\S+/;

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

export function parseChangelog(text: string): Changelog {
  const sections: { label: string; date?: string; lines: string[] }[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      const match = HEADING.exec(line);
      if (!match) throw new Error(`Ungültige Überschrift im Changelog: „${line}“ (erwartet: ## [Unreleased] oder ## [X.Y.Z] – JJJJ-MM-TT)`);
      sections.push({ label: match[1]!, date: match[2], lines: [] });
    } else if (sections.length && !LINK_DEFINITION.test(line)) {
      sections.at(-1)!.lines.push(line);
    }
  }
  if (sections[0]?.label !== 'Unreleased' || sections[0].date) {
    throw new Error('Der Changelog muss mit dem Abschnitt „## [Unreleased]“ (ohne Datum) beginnen.');
  }
  const releases: Release[] = [];
  for (const section of sections.slice(1)) {
    if (section.label === 'Unreleased') throw new Error('Der Abschnitt [Unreleased] darf nur einmal vorkommen.');
    versionParts(section.label);
    if (!section.date || !validDate(section.date)) throw new Error(`Version ${section.label} braucht ein gültiges Datum im Format JJJJ-MM-TT.`);
    const previous = releases.at(-1);
    if (previous && compareVersions(section.label, previous.version) >= 0) {
      throw new Error(`Versionen müssen absteigend sortiert und eindeutig sein: ${section.label} steht unter ${previous.version}.`);
    }
    releases.push({ version: section.label, date: section.date, body: section.lines.join('\n').trim() });
  }
  return { unreleased: sections[0].lines.join('\n').trim(), releases };
}

export function releaseNotes(text: string, version: string): string {
  const release = parseChangelog(text).releases.find((r) => r.version === version);
  if (!release) throw new Error(`CHANGELOG.md enthält keinen Abschnitt für Version ${version}.`);
  if (!release.body) throw new Error(`Der Abschnitt für Version ${version} in CHANGELOG.md ist leer.`);
  return release.body;
}

/** Prüft den Aufbau und dass keine Version über der aktuellen Projektversion steht. */
export function checkChangelog(text: string, packageVersion: string) {
  const { releases } = parseChangelog(text);
  const newest = releases[0];
  if (newest && compareVersions(newest.version, packageVersion) > 0) {
    throw new Error(`Version ${newest.version} im Changelog liegt über der Projektversion ${packageVersion}.`);
  }
  return releases;
}

/** Für den Release-Workflow: Tag muss vX.Y.Z sein und zur Projektversion passen. */
export function notesForTag(text: string, tag: string, packageVersion: string) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error(`Ungültiger Release-Tag: ${tag} (erwartet: vX.Y.Z)`);
  if (match[1] !== packageVersion) throw new Error(`Tag ${tag} passt nicht zur Projektversion ${packageVersion} in package.json.`);
  checkChangelog(text, packageVersion);
  return releaseNotes(text, match[1]!);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const text = fs.readFileSync('CHANGELOG.md', 'utf8');
    const packageVersion: string = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    switch (process.argv[2]) {
      case 'check': {
        const releases = checkChangelog(text, packageVersion);
        console.log(`Changelog in Ordnung (${releases.length} Release${releases.length === 1 ? '' : 's'}, Projektversion ${packageVersion}).`);
        break;
      }
      case 'notes': process.stdout.write(releaseNotes(text, process.argv[3] ?? packageVersion) + '\n'); break;
      case 'release': process.stdout.write(notesForTag(text, process.argv[3] ?? '', packageVersion) + '\n'); break;
      default: throw new Error('Aufruf: node scripts/changelog.ts check | notes [X.Y.Z] | release vX.Y.Z');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
