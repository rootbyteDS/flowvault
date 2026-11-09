import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// npm ci also runs inside Docker, which intentionally has no Git metadata.
if (fs.existsSync('.git')) {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  const existing = configured.stdout?.trim();
  const hooks = spawnSync('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], { encoding: 'utf8' }).stdout?.trim();
  if ((existing && existing !== '.githooks') || (!existing && hooks && fs.existsSync(hooks))) {
    console.warn('Bestehende Git-Hooks bleiben erhalten. Bitte node scripts/version.ts commit in den vorhandenen pre-commit-Hook einbinden. CI prüft die Version zusätzlich.');
  } else {
    const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
    if (result.status !== 0) process.exitCode = 1;
    else console.log('FlowVault-Versionshook aktiviert.');
  }
}
