import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = ['package.json', 'package-lock.json'];
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

export function versionParts(version: unknown): number[] {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Ungültige Projektversion: ${String(version)} (erwartet: MAJOR.MINOR.PATCH)`);
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Versionsnummer ist zu groß.');
  return parts;
}

export function compareVersions(a: unknown, b: unknown): number {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

function manifests() {
  const pkg = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  const lock = JSON.parse(fs.readFileSync(files[1], 'utf8'));
  versionParts(pkg.version);
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) {
    throw new Error('package.json und package-lock.json müssen dieselbe Version enthalten.');
  }
  return { pkg, lock };
}

function headVersion(ref: string): string {
  const version: unknown = JSON.parse(git('show', `${ref}:package.json`)).version;
  versionParts(version);
  return version as string;
}

export function bumpVersion() {
  const { pkg, lock } = manifests();
  const [major, minor, patch] = versionParts(pkg.version);
  const next = `${major}.${minor}.${patch + 1}`;
  versionParts(next);
  pkg.version = lock.version = lock.packages[''].version = next;
  fs.writeFileSync(files[0], JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(files[1], JSON.stringify(lock, null, 2) + '\n');
  console.log(`FlowVault-Version: ${next}`);
}

export function checkVersion(base?: string) {
  const { pkg } = manifests();
  if (!base || /^0+$/.test(base)) {
    console.log(`Konsistente Version: ${pkg.version} (kein Vergleichsstand vorhanden)`);
    return;
  }
  // Resolve to a commit first, never interpret an external ref as a Git option.
  const commit = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`);
  const previous = headVersion(commit);
  if (compareVersions(pkg.version, previous) <= 0) {
    throw new Error(`Version ${pkg.version} muss höher als ${previous} sein. Bitte npm run version:bump ausführen und beide Paketdateien übernehmen.`);
  }
  console.log(`Versionsprüfung: ${previous} → ${pkg.version}`);
}

export function prepareCommit() {
  const changed = git('diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB', '-z');
  if (!changed) return;
  // Never accidentally stage other work or overwrite partially staged manifests.
  for (const file of files) {
    const result = spawnSync('git', ['diff', '--quiet', '--', file]);
    if (result.status !== 0) throw new Error(`${file} enthält nicht vorgemerkte Änderungen. Beide Paketdateien zuerst vollständig prüfen und mit git add vormerken; danach erneut committen.`);
  }
  const { pkg } = manifests();
  const exists = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' }).status === 0;
  if (exists) {
    const previous = headVersion('HEAD');
    const comparison = compareVersions(pkg.version, previous);
    if (comparison < 0) throw new Error(`Version ${pkg.version} darf nicht unter ${previous} liegen.`);
    if (comparison === 0) {
      bumpVersion();
      git('add', '--', ...files);
    }
  }
  manifests();
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    switch (process.argv[2]) {
      case 'bump': bumpVersion(); break;
      case 'check': checkVersion(process.argv[3] ?? process.env.VERSION_BASE); break;
      case 'commit': prepareCommit(); break;
      default: throw new Error('Aufruf: node scripts/version.ts bump|check [Basis-Commit]|commit');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
