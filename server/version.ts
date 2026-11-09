import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { BuildInfo } from '../shared/system.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const revisionValue = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{7,64}$/i.test(v) ? v.toLowerCase() : null;

/** Git is optional: production images deliberately contain neither Git nor its metadata. */
export function currentBuild(): BuildInfo {
  let revision = revisionValue(process.env.APP_REVISION);
  let modified = false;
  if (fs.existsSync(path.join(root, '.git'))) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    try {
      revision ??= revisionValue(git(['rev-parse', 'HEAD']));
      modified = !!git(['status', '--porcelain']);
    } catch { /* Version remains available without a Git executable. */ }
  }
  return { version, revision, modified, builtAt: null };
}

export function installedBuild(): BuildInfo {
  const current = currentBuild();
  if (fs.existsSync(path.join(root, '.git'))) return current;
  try {
    const built = JSON.parse(fs.readFileSync(path.join(root, 'dist/build-info.json'), 'utf8'));
    if (built.version === version) {
      return {
        version, revision: revisionValue(built.revision), modified: built.modified === true,
        builtAt: typeof built.builtAt === 'string' && Number.isFinite(Date.parse(built.builtAt)) ? built.builtAt : null,
      };
    }
  } catch { /* A direct npm start does not require a frontend build. */ }
  return current;
}

export const buildInfo = installedBuild();
