/**
 * FlowVault MCP – Agents fragen hier nur lesend, wie es den n8n-Instanzen geht.
 *
 * Eigenständiger Dienst mit eigener Datenbank (mcp.db: Ein/Aus und Token-Hashes). Spricht nur mit
 * dem Core – mit einem eigenen Token, das der Core nur für lesende Pfade annimmt – und nie mit n8n.
 * Bekommt vom Core eine feste Liste von Umgebungsvariablen (kein APP_SECRET, kein INTERNAL_TOKEN).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { t } from '../../shared/i18n/server.ts';
import { createApp } from './app.ts';
import { coreClient } from './core.ts';
import { createStore } from './store.ts';

const PORT = Number(process.env.MCP_PORT ?? 4200);
const HOST = process.env.MCP_HOST ?? '127.0.0.1';
const DATA_DIR = path.resolve(process.env.MCP_DATA_DIR ?? process.env.DATA_DIR ?? 'data');
const CORE_URL = process.env.CORE_URL ?? `http://127.0.0.1:${process.env.CORE_PORT ?? 4000}`;

/** MCP_TOKEN oder – lokal – die Datei, die der Core anlegt. Bei jedem Aufruf gelesen, falls der Dienst vor dem Core startet. */
function token(): string {
  if (process.env.MCP_TOKEN) return process.env.MCP_TOKEN;
  try {
    return fs.readFileSync(path.join(DATA_DIR, 'mcp.token'), 'utf8').trim();
  } catch {
    return '';
  }
}

process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(DATA_DIR, 'mcp.db'));
db.exec('PRAGMA journal_mode = WAL;');

const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const app = createApp({ store: createStore(db), core: coreClient(CORE_URL, token), serviceToken: token, version });

app.listen(PORT, HOST, (err?: Error) => {
  if (err) {
    console.error(`  ${t('log.mcpCannotListen', { address: `${HOST}:${PORT}`, reason: err.message })}`);
    process.exit(1);
  }
  console.log(`  ${t('log.mcpListening', { url: `http://${HOST}:${PORT}` })}`);
});

// Vom Core gestartet: mit ihm zusammen beenden, auch wenn er hart abgeschossen wurde
if (process.send) process.on('disconnect', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
