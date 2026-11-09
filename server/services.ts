/**
 * Startet die Zusatzdienste (derzeit: Health-Dienst) als Kindprozesse des Cores.
 * So bleibt FlowVault ein System – ein Befehl, ein Container –, und ein Absturz im
 * Dienst reißt den Core nicht mit. Der Dienst lauscht nur auf 127.0.0.1.
 *
 * Mit gesetztem HEALTH_URL läuft der Dienst woanders und wird hier nicht gestartet.
 */
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './db.ts';
import { HEALTH_PORT, INTERNAL_TOKEN } from './internal.ts';
import { t } from '../shared/i18n/server.ts';

const HEALTH_ENTRY = fileURLToPath(new URL('../services/health/index.ts', import.meta.url));

let child: ChildProcess | null = null;
let stopping = false;
let delay = 1_000;

export function startHealthService(corePort: number) {
  if (process.env.HEALTH_URL) {
    console.log(`  ${t('log.healthExternal', { url: process.env.HEALTH_URL })}`);
    return;
  }
  const spawn = () => {
    const startedAt = Date.now();
    child = fork(HEALTH_ENTRY, [], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        INTERNAL_TOKEN,
        CORE_URL: `http://127.0.0.1:${corePort}`,
        HEALTH_HOST: '127.0.0.1',
        HEALTH_PORT: String(HEALTH_PORT),
        HEALTH_DATA_DIR: process.env.HEALTH_DATA_DIR ?? DATA_DIR,
      },
    });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return;
      // Lief er eine Weile stabil, sofort neu starten; sonst mit wachsender Wartezeit
      if (Date.now() - startedAt > 60_000) delay = 1_000;
      console.warn(`  ${t('log.healthExited', { reason: signal ?? t('log.healthExitCode', { code: code ?? '?' }), seconds: Math.round(delay / 1000) })}`);
      setTimeout(spawn, delay).unref();
      delay = Math.min(delay * 2, 60_000);
    });
  };
  spawn();

  const shutdown = (signal: NodeJS.Signals) => {
    stopping = true;
    child?.kill('SIGTERM');
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('exit', () => child?.kill('SIGTERM'));
}
