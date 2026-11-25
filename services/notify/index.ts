/**
 * FlowVault Notify – Messenger-Feed & Push-Dienst für die Android-Companion-App.
 *
 * Eigenständiger Kindprozess mit eigener Datenbank (notify.db). Erhält keinen APP_SECRET,
 * keine Workflow-Snapshots und kein INTERNAL_TOKEN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { t } from '../../shared/i18n/server.ts';
import { createApp } from './app.ts';
import { coreClient } from './core.ts';
import { createStore } from './store.ts';

const PORT = Number(process.env.NOTIFY_PORT ?? 4300);
const HOST = process.env.NOTIFY_HOST ?? '127.0.0.1';
const DATA_DIR = path.resolve(process.env.NOTIFY_DATA_DIR ?? process.env.DATA_DIR ?? 'data');
const CORE_URL = process.env.CORE_URL ?? `http://127.0.0.1:${process.env.CORE_PORT ?? 4000}`;

function token(): string {
  if (process.env.NOTIFY_TOKEN) return process.env.NOTIFY_TOKEN;
  try {
    return fs.readFileSync(path.join(DATA_DIR, 'notify.token'), 'utf8').trim();
  } catch {
    return '';
  }
}

process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(DATA_DIR, 'notify.db'));
db.exec('PRAGMA journal_mode = WAL;');

const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const { app, hub } = createApp({ store: createStore(db), core: coreClient(CORE_URL, token), serviceToken: token, version });

app.listen(PORT, HOST, (err?: Error) => {
  if (err) {
    console.error(`  ${t('log.notifyCannotListen', { address: `${HOST}:${PORT}`, reason: err.message })}`);
    process.exit(1);
  }
  console.log(`  ${t('log.notifyListening', { url: `http://${HOST}:${PORT}` })}`);
});

const shutdown = () => {
  hub.closeAll();
  process.exit(0);
};
if (process.send) process.on('disconnect', shutdown);
process.once('SIGTERM', shutdown);
