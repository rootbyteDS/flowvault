/**
 * Startet die Zusatzdienste (Health-Dienst, MCP-Dienst) als Kindprozesse des Cores.
 * So bleibt FlowVault ein System – ein Befehl, ein Container –, und ein Absturz in einem
 * Dienst reißt den Core nicht mit. Die Dienste lauschen nur auf 127.0.0.1.
 *
 * Mit gesetztem HEALTH_URL bzw. MCP_URL läuft der Dienst woanders und wird hier nicht gestartet.
 */
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './db.ts';
import { HEALTH_PORT, INTERNAL_TOKEN, MCP_TOKEN } from './internal.ts';
import { MCP_PORT } from './mcp.ts';
import { t } from '../shared/i18n/server.ts';

interface ServiceSpec {
  name: string;
  entry: string;
  /** Adresse eines extern betriebenen Dienstes; dann wird nichts gestartet. */
  external: string | undefined;
  env: (corePort: number) => NodeJS.ProcessEnv;
}

/** Variablen, die der MCP-Dienst von außen übernimmt. Bewusst ohne APP_SECRET, INTERNAL_TOKEN und Zugangsdaten. */
const MCP_INHERITED = ['PATH', 'NODE_ENV', 'TZ', 'LANG', 'DEFAULT_LANGUAGE'] as const;

export function mcpEnv(corePort: number, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of MCP_INHERITED) if (source[key] !== undefined) env[key] = source[key];
  return {
    ...env,
    MCP_TOKEN,
    CORE_URL: `http://127.0.0.1:${corePort}`,
    MCP_HOST: '127.0.0.1',
    MCP_PORT: String(MCP_PORT),
    MCP_DATA_DIR: source.MCP_DATA_DIR ?? DATA_DIR,
  };
}

const SERVICES: ServiceSpec[] = [
  {
    name: 'health',
    entry: fileURLToPath(new URL('../services/health/index.ts', import.meta.url)),
    external: process.env.HEALTH_URL,
    env: (corePort) => ({
      ...process.env,
      INTERNAL_TOKEN,
      CORE_URL: `http://127.0.0.1:${corePort}`,
      HEALTH_HOST: '127.0.0.1',
      HEALTH_PORT: String(HEALTH_PORT),
      HEALTH_DATA_DIR: process.env.HEALTH_DATA_DIR ?? DATA_DIR,
    }),
  },
  {
    name: 'mcp',
    entry: fileURLToPath(new URL('../services/mcp/index.ts', import.meta.url)),
    external: process.env.MCP_URL,
    env: (corePort) => mcpEnv(corePort),
  },
];

const children = new Set<ChildProcess>();
let stopping = false;

function supervise(spec: ServiceSpec, corePort: number) {
  if (spec.external) {
    console.log(`  ${t('log.serviceExternal', { service: spec.name, url: spec.external })}`);
    return;
  }
  let delay = 1_000;
  const spawn = () => {
    const startedAt = Date.now();
    const child = fork(spec.entry, [], { cwd: path.resolve('.'), env: spec.env(corePort) });
    children.add(child);
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (stopping) return;
      // Lief er eine Weile stabil, sofort neu starten; sonst mit wachsender Wartezeit
      if (Date.now() - startedAt > 60_000) delay = 1_000;
      const reason = signal ?? t('log.serviceExitCode', { code: code ?? '?' });
      console.warn(`  ${t('log.serviceExited', { service: spec.name, reason, seconds: Math.round(delay / 1000) })}`);
      setTimeout(spawn, delay).unref();
      delay = Math.min(delay * 2, 60_000);
    });
  };
  spawn();
}

export function startServices(corePort: number) {
  for (const spec of SERVICES) supervise(spec, corePort);

  const shutdown = (signal: NodeJS.Signals) => {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('exit', () => {
    for (const child of children) child.kill('SIGTERM');
  });
}
