import { db, getSetting, setSetting, tx } from './db.ts';
import { decrypt, encrypt, isEncryptedSnapshot, pack, unpack } from './crypto.ts';
import { LocalizedError } from '../shared/i18n/index.ts';
import { t } from '../shared/i18n/server.ts';

const STATE_KEY = 'snapshot_encryption_v1';

/** Erst vor dem HTTP-Listener und den Hintergrunddiensten aufrufen. */
export function migrateSnapshots(): number {
  let state: string | undefined;
  try {
    const stored = getSetting(STATE_KEY);
    state = stored ? decrypt(stored) : undefined;
    if (state !== undefined && state !== 'ready' && state !== 'cleanup') throw new Error('Invalid migration state');
    // Bei einem Update keinen falschen/neuen Schlüssel für den Altbestand übernehmen.
    if (!state) {
      for (const row of db.prepare('SELECT api_key_enc FROM instances').iterate()) decrypt(String(row.api_key_enc));
      for (const key of ['admin_totp_secret', 'ai_api_key']) {
        const value = getSetting(key);
        if (value) decrypt(value);
      }
    }
  } catch {
    throw new LocalizedError({ key: 'errors.storage.keyUnavailable' });
  }
  // Die verschlüsselte Statusmarke prüft auch bei späteren Starts den Anwendungsschlüssel.
  if (state === 'ready') return 0;

  console.log(t('log.encryptingSnapshots'));
  let migrated = 0;
  if (!state) {
    tx(() => {
      const select = db.prepare('SELECT id, snapshot FROM versions WHERE id > ? ORDER BY id LIMIT 100');
      const update = db.prepare('UPDATE versions SET snapshot = ? WHERE id = ?');
      let lastId = 0;
      for (;;) {
        const rows = select.all(lastId) as { id: number; snapshot: Uint8Array }[];
        if (!rows.length) break;
        for (const row of rows) {
          try {
            const snapshot = unpack(row.snapshot, { allowLegacy: true });
            if (!isEncryptedSnapshot(row.snapshot)) {
              update.run(pack(snapshot), row.id);
              migrated++;
            }
          } catch {
            throw new LocalizedError({ key: 'errors.storage.snapshotUnreadable', params: { id: row.id } });
          }
          lastId = row.id;
        }
      }
      // In derselben Transaktion wie die Daten: Nach einem Abbruch Bereinigung wiederholen.
      setSetting(STATE_KEY, encrypt('cleanup'));
    });
  }

  try {
    // Alte gzip-Inhalte auch aus freien Seiten und dem WAL der laufenden Datenbank entfernen.
    // Externe Backups und Dateisystem-Snapshots werden dadurch nicht verändert.
    db.exec('VACUUM');
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
    if (checkpoint.busy) throw new Error('Snapshot cleanup is blocked by another database connection');
    setSetting(STATE_KEY, encrypt('ready'));
  } catch {
    throw new LocalizedError({ key: 'errors.storage.cleanupFailed' });
  }
  return migrated;
}
