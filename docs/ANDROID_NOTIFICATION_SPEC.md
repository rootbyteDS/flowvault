# Spezifikation: FlowVault Android Notification App („FlowVault Notify“)

**Status:** Implementiert (Backend `services/notify` + Web-UI + Android-App `android/`)  
**Zielplattform:** Android (Min SDK 26 / Android 8.0+, Target SDK 35)  
**Bezug:** FlowVault Core (`server/`), Health-Dienst (`services/health/`), neuer Notification-Dienst (`services/notify/`)

---

## 1. Überblick & Produktvision

FlowVault überwacht beliebig viele n8n-Instanzen, sichert Workflow-Änderungen als Versionen und erkennt über den Health-Dienst Fehlläufe sowie Fehlerquoten-Regressionen. Bisher sind diese Informationen nur im Browser (oder lesend über MCP für KI-Agents) sichtbar.

**FlowVault Notify** ist eine schlanke Android-Companion-App mit **Messenger-Erlebnis**, die Betreiber zeitnah über **Fehlläufe, Health-Warnungen, Sync-Störungen und Workflow-Änderungen** informiert – ohne E-Mail-Flut, ohne fremde Cloud-Dienste und im gleichen Sicherheits- und Designmodell wie FlowVault selbst.

### Leitprinzipien

1. **Messenger statt Log-Viewer:** Jede n8n-Instanz verhält sich wie ein Chat-Kanal (mit Ungelesen-Zähler, Vorschau, Zeitstempel, Stummschaltung). Ereignisse erscheinen als strukturierte Nachrichten-Karten; wiederkehrende Fehler werden gebündelt aktualisiert statt den Chat zu fluten, und behobene Störungen erhalten eine Entwarnung („Wieder stabil“).
2. **Self-Hosted & Privacy-First:** Keine zentrale Cloud-Infrastruktur erforderlich. Externe Push-Transportwege (UnifiedPush / optionales FCM) erhalten **niemals** Klartext-Inhalte (keine Workflow-Namen, Nodes oder Fehlermeldungen), sondern nur ein minimales Wake-up-Signal (*Zero-Payload Tickle*).
3. **Datensparsam & defensiv:** Workflow-Snapshots (JSON), Node-Parameter und n8n-API-Keys verlassen FlowVault nie in Richtung Mobilgerät. In v1 gibt es **keine** schreibenden n8n-Aktionen (kein Rollback aus der Push-Notification); kritische Eingriffe erfolgen bewusst im Browser über Deep-Links.
4. **Ein System im Betrieb:** Auf Serverseite wird die Mobile-Anbindung als weiterer isolierter Kindprozess `services/notify` ergänzt – nach demselben Muster wie `services/health` und `services/mcp`.

---

## 2. Ereignistypen („Fails & Änderungen“)

Die App deckt sowohl **Betriebsstörungen (Fails)** als auch **Versions- und Lebenszyklus-Änderungen** ab. Alle Quellen sind bereits in FlowVault vorhanden (`flowvault.db` und `health.db`).

### 2.1 Übersicht der Ereignisse

| Event-Typ (`kind`) | Kategorie | Datenquelle in FlowVault | Standard-Priorität | Messenger-Darstellung |
|---|---|---|---|---|
| `alert_opened` | Fail | `health.db` (`alerts` neu/reaktiviert) | **Kritisch** | Rote Alert-Karte: Fehlerquote vs. Basis („45 % seit v14, vorher 0 %“), Top-Node(s), Rollback-Vorschlag (`v13`) |
| `alert_escalated` | Fail | `health.db` (`alerts` deutlicher Anstieg) | **Kritisch** | Aktualisiert bestehende Alert-Karte oder postet Follow-up-Update im Thread |
| `alert_resolved` | Entwarnung | `health.db` (`alerts.status -> resolved`) | **Info** | Grüne Entwarnungs-Karte mit Bezug auf die gelöste Warnung („Nach v15 wieder stabil“) |
| `execution_failed` | Fail | `health.db` (`executions` mit `error`/`crashed`) | **Hoch** | Fehler-Karte pro Workflow + Node + Meldung, **gebündelt** bei Mehrfachfehlern (`×12 seit 14:02`) |
| `execution_recovered` | Entwarnung | `health.db` (`executions` wieder `success`) | **Info** *(opt-in)* | Grüne Kurz-Meldung („Läuft wieder – letzter Lauf erfolgreich“) |
| `sync_error` | Betrieb | `flowvault.db` (`events.kind = 'sync_error'`) | **Kritisch** | Rote Betriebsmeldung: Instanz nicht erreichbar / API-Fehler |
| `sync_recovered` | Entwarnung | `flowvault.db` (`instances.last_sync_ok: 0 -> 1`) | **Info** | Grüne Betriebsmeldung: Backup-Sync wieder erfolgreich |
| `health_poll_error` | Betrieb | `health.db` (`poll_state.ok: 1 -> 0`) | **Hoch** | Warnung: Ausführungsabruf für Instanz fehlgeschlagen |
| `health_poll_recovered` | Entwarnung | `health.db` (`poll_state.ok: 0 -> 1`) | **Info** | Entwarnung: Ausführungsabruf wieder aktiv |
| `workflow_changed` | Änderung | `flowvault.db` (`events.kind = 'changed'` + `versions`) | **Normal** | Änderungs-Karte: `v13 → v14`, `ChangeSummary` („„Slack“ hinzugefügt · „HTTP Request“ geändert“), Aktiv-Status-Wechsel, KI-Titel/Stichpunkte sobald verfügbar |
| `workflow_created` | Änderung | `flowvault.db` (`events.kind = 'created'`) | **Normal** | Neue Workflow-Karte (`v1`, Anzahl Nodes, aktiv/inaktiv) |
| `workflow_deleted` | Änderung | `flowvault.db` (`events.kind = 'deleted'`) | **Hoch** | Warn-Karte: Workflow in n8n gelöscht (Historie in FlowVault erhalten) |
| `workflow_restored` | Änderung | `flowvault.db` (`events.kind = 'restored'`) | **Normal** | Info-Karte: Version `vX` wiederhergestellt → neue Version `vY` |
| `workflow_promoted` | Änderung | `flowvault.db` (`events.kind = 'promoted'`) | **Normal** | Info-Karte: Aus Umgebung übernommen → neue Version `vY` |

### 2.2 Anti-Lärm-Regeln (Alert-Fatigue-Schutz)

Damit sich die App wirklich wie ein nützlicher Messenger anfühlt und nicht nervt:

- **Burst-Gruppierung (Coalescing):** Wiederholte `execution_failed`-Ereignisse mit demselben `(instanceId, workflowId, errorNode, normalizedMessage)` innerhalb eines konfigurierbaren Fensters (Standard: **10 Minuten**) erzeugen **keine** neue Nachricht, sondern erhöhen `groupCount` und `updatedAt` der bestehenden Nachricht. Nur das erste Auftreten (und optional ein Meilenstein, z. B. ab `×10`, `×50`) löst erneut einen Push-Ton aus.
- **Kein Initial-Sync-Spam:** Wenn eine neue Instanz erstmals synchronisiert wird und mehr als z. B. 5 Workflows gleichzeitig `created` sind, erzeugt `services/notify` eine einzige Sammel-Nachricht („Erstsicherung abgeschlossen: 42 Workflows gesichert“) statt 42 Einzelmeldungen.
- **Nachträgliche KI-Anreicherung ohne Doppel-Ping:** Da KI-Änderungstexte (`server/ai.ts`) asynchron nach `recordWorkflow()` erzeugt werden, aktualisiert `services/notify` die bestehende `workflow_changed`-Nachricht still um `aiSummary` (Titel + Stichpunkte), sobald Melious geantwortet hat – ohne erneut zu klingeln.
- **Manuelle Testläufe:** Folgt der bestehenden Health-Einstellung (`includeManual = false` standardmäßig, Editor-Testläufe lösen keine Fail-Pings aus).
- **Ruhezeiten (Quiet Hours):** Pro Gerät konfigurierbar (z. B. 22:00–07:00), mit Option *„Kritische Warnungen (`alert_opened`, `sync_error`) trotzdem zustellen“*.
- **Stummschalten (Snooze):** Pro Instanz oder pro einzelnem Workflow für `1 Std.`, `8 Std.`, `Bis morgen 08:00` oder `Dauerhaft`.

---

## 3. Systemarchitektur

### 3.1 Komponentenübersicht

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ FlowVault Container / Host                                              │
│                                                                         │
│  ┌────────────────────┐     /internal/*      ┌───────────────────────┐  │
│  │ FlowVault Core     │◄────────────────────►│ services/health       │  │
│  │ server/index.ts    │   (INTERNAL_TOKEN)   │ health.db             │  │
│  │ flowvault.db       │                      │ (Poller + Evaluator)  │  │
│  │                    │                      └──────────┬────────────┘  │
│  │  • /api/notify/*   │ (Admin-Auth + CSRF)             │               │
│  │  • /mobile/v1/*    │ (Device-Token + RateLimit)      │ Ingest-Event  │
│  │                    │                                 │ (127.0.0.1)   │
│  │         │          │                                 ▼               │
│  │         │ Ingest   │   NOTIFY_TOKEN       ┌───────────────────────┐  │
│  │         └──────────┼─────────────────────►│ services/notify       │  │
│  │                    │                      │ notify.db             │  │
│  │                    │◄─────────────────────┤ (127.0.0.1:4300)      │  │
│  │                    │  Fallback-Read       │ • Pairing & Devices   │  │
│  │                    │  (/internal/*)       │ • Coalescing & Feed   │  │
│  └─────────┬──────────┘                      │ • SSE Hub             │  │
│            │                                 │ • UnifiedPush Sender  │  │
│            │ Reverse Proxy (HTTPS)           └──────────┬────────────┘  │
└────────────┼────────────────────────────────────────────┼───────────────┘
             │                                            │ Zero-Payload
             │ HTTPS + Bearer fv_app_…                    │ Tickle (optional)
             │ (REST + SSE Stream)                        ▼
             │                                  ┌───────────────────────┐
             │                                  │ UnifiedPush Server    │
             │                                  │ (z. B. self-hosted    │
             │                                  │  ntfy / Sunup)        │
             ▼                                  └──────────┬────────────┘
┌──────────────────────────────────────────────────────────┼──────────────┐
│ Android App („FlowVault Notify“)                         │ Wake-up      │
│  • Room DB (Offline-Messenger-Cache)                     ▼              │
│  • SSE-Client (live) + Optional Foreground Service / WorkManager        │
│  • UnifiedPush Connector → triggert direkten Fetch von /mobile/v1/…     │
│  • NotificationCompat.MessagingStyle + Notification Channels            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Einbindung als Kindprozess `services/notify`

Analog zu `services/health` (`HEALTH_PORT=4100`) und `services/mcp` (`MCP_PORT=4200`) startet `server/services.ts` den neuen Dienst als überwachten Kindprozess:

- **Port & Bind:** `NOTIFY_PORT` (Standard `4300`), ausschließlich `127.0.0.1` (nie direkt nach außen).
- **Datenbank:** Eigene SQLite-Datei `data/notify.db` (`mode 0o600`, `WAL`, `foreign_keys = ON`).
- **Umgebungsisolation:** Wie `mcpEnv()` in `server/services.ts` erhält `services/notify` **weder** `APP_SECRET` noch `INTERNAL_TOKEN` (nur sein eigenes `NOTIFY_TOKEN` aus `data/notify.token`, das sich von `INTERNAL_TOKEN` und `MCP_TOKEN` unterscheidet).
- **Rechte am Core (`/internal/*`):** Der Core erweitert `server/internal.ts` um eine explizite, schmale Allowlist `NOTIFY_PATHS` für `NOTIFY_TOKEN`:
  - `GET /internal/instances`
  - `GET /internal/workflows`
  - `GET /internal/activity`
  - `GET /internal/health/alerts`
  - `POST /internal/health/alerts/:id/dismiss` (einzige erlaubte Status-Aktion; keine Snapshots, kein direkter n8n-Zugriff, kein Restore!).
- **Ereignis-Zufluss (Hybrid: Sofort-Ingest + Fallback):**
  - Core (`server/sync.ts`, `server/ai.ts`) und Health (`services/health/evaluate.ts`, `services/health/poller.ts`) senden bei relevanten Zustandsübergängen einen asynchronen, kurzen `POST http://127.0.0.1:${NOTIFY_PORT}/v1/ingest` (Timeout 2 s, fehlertolerant – ein Ausfall von `services/notify` blockiert weder Sync noch Health).
  - Ergänzend prüft `services/notify` beim Start und periodisch (alle 5 Min.) auf etwaige verpasste Ereignisse/Alert-Zustände, sodass Neustarts keine Lücken hinterlassen.

### 3.3 Push- & Echtzeit-Zustellung unter Android (Doze-sicher & Self-Hosted)

Android versetzt Apps im Hintergrund aggressiv in den **Doze Mode**. Gleichzeitig soll FlowVault ohne Zwangsbindung an Google/FCM funktionieren. Die App unterstützt daher ein gestuftes, konfigurierbares Zustellmodell:

| Modus | Funktionsweise | Latenz | Akku | Externe Infra | Empfohlen für |
|---|---|---|---|---|---|
| **1. UnifiedPush (Empfohlen)** | App registriert UnifiedPush-Distributor (z. B. selbst gehostetes `ntfy` oder `Sunup`). FlowVault sendet nur ein **leeres Wake-up-Signal** (`{"v":1,"t":"wake","seq":1245}`). App wacht auf und lädt die Nachricht direkt per HTTPS von FlowVault. | ~1–3 Sek. | Sehr gut | Eigener ntfy / UnifiedPush-Distributor | Mobilfunk & Alltag, 100 % Google-frei |
| **2. Echtzeit-Dienst (SSE + Foreground Service)** | Dauerhafte HTTPS-SSE-Verbindung (`GET /mobile/v1/stream`) mit stillem Android-Statussymbol („Verbunden mit FlowVault“), wie bei Gotify. | < 1 Sek. | Gut (~1–2 %/Tag) | **Keine** | LAN / Tailscale / WireGuard ohne ntfy |
| **3. Periodischer Sync (WorkManager)** | Periodischer Abruf über `WorkManager` (Standard alle 15 Min.) + sofortiger SSE-Stream, solange die App im Vordergrund ist. | bis 15 Min. | Minimal | **Keine** | Fallback / minimale Berechtigungen |

> **Zero-Payload-Garantie:** Über einen UnifiedPush-Endpunkt gehen ausschließlich `{ "v": 1, "t": "wake", "seq": <number> }` (optional zusätzlich mit RFC 8291 WebPush-Verschlüsselung). Weder Workflow-Namen noch Fehlermeldungen oder Instanznamen verlassen das eigene FlowVault-Backend über Drittsysteme.

*(Optional für spätere Releases: Ein getrennter Build-Flavor `play` könnte zusätzlich FCM Data-Only-Tickles nach demselben Zero-Payload-Prinzip anbieten. Der Haupt-Build `foss` bleibt frei von Google Play Services und ist F-Droid-/GitHub-APK-tauglich.)*

---

## 4. Datenmodell (`data/notify.db`)

```sql
-- Globale Einstellungen (z. B. enabled = '0'|'1', retention_days = '90', default_redaction = '1')
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Kurzlebige QR-Pairing-Codes (TTL 5 Min., einmalig)
CREATE TABLE IF NOT EXISTS pairing_codes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash         TEXT NOT NULL UNIQUE,   -- SHA-256 des Einmal-Codes
  label             TEXT NOT NULL,          -- Vorgeschlagener Gerätename
  allowed_instances TEXT,                   -- JSON int[] oder NULL (= alle)
  redaction_mode    TEXT NOT NULL DEFAULT 'lockscreen', -- none | lockscreen | full
  attempts          INTEGER NOT NULL DEFAULT 0,
  expires_at        INTEGER NOT NULL,
  used_at           INTEGER,
  created_at        INTEGER NOT NULL
);

-- Gekoppelte Mobilgeräte
CREATE TABLE IF NOT EXISTS devices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  platform          TEXT NOT NULL DEFAULT 'android',
  token_hash        TEXT NOT NULL UNIQUE,   -- SHA-256 von "fv_app_..."
  token_hint        TEXT NOT NULL,          -- z. B. "fv_app_9k2a…"
  allowed_instances TEXT,                   -- JSON int[] oder NULL (= alle)
  redaction_mode    TEXT NOT NULL DEFAULT 'lockscreen',
  push_type         TEXT NOT NULL DEFAULT 'none', -- none | unifiedpush | sse_bg
  push_endpoint     TEXT,                   -- UnifiedPush-URL (validiert)
  language          TEXT NOT NULL DEFAULT 'de',
  quiet_hours       TEXT,                   -- JSON { enabled, start, end, tz, allowCritical }
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER
);

-- Nachrichten-Feed (monotone Sequenznummer `seq` für lückenlosen Inkremental-Sync)
CREATE TABLE IF NOT EXISTS messages (
  seq               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid         TEXT UNIQUE,            -- Idempotenz-Schlüssel (z. B. "core:event:42")
  group_key         TEXT,                   -- Coalescing-Schlüssel für Fehler-Bursts
  instance_id       INTEGER NOT NULL,
  instance_name     TEXT NOT NULL,
  instance_color    TEXT NOT NULL DEFAULT '#ea4b71',
  workflow_id       INTEGER,
  workflow_name     TEXT,
  version_id        INTEGER,
  version_number    INTEGER,
  alert_id          INTEGER,
  kind              TEXT NOT NULL,          -- siehe Abschnitt 2.1
  severity          TEXT NOT NULL,          -- critical | high | normal | info
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  metadata          TEXT NOT NULL DEFAULT '{}', -- JSON: ChangeSummary, aiSummary, failingNodes, rate, rollback, errorNode, errorMessage
  group_count       INTEGER NOT NULL DEFAULT 1,
  resolved_by_seq   INTEGER,                -- Verweis auf Entwarnungs-Nachricht
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_instance_seq ON messages(instance_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(updated_at DESC);

-- Filter & Stummschaltung pro Gerät (global, pro Instanz oder pro Workflow)
CREATE TABLE IF NOT EXISTS device_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  scope_type  TEXT NOT NULL,                -- global | instance | workflow
  scope_id    INTEGER NOT NULL DEFAULT 0,   -- 0 bei global, sonst instance_id oder workflow_id
  enabled_kinds TEXT,                       -- JSON string[] oder NULL (= Vererbung)
  muted_until INTEGER,                      -- NULL = aktiv, -1 = dauerhaft stumm, >0 = Unix-ms
  UNIQUE (device_id, scope_type, scope_id)
);

-- Lesestand pro Gerät und Kanal (0 = alle / global, >0 = instance_id)
CREATE TABLE IF NOT EXISTS device_read_state (
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  instance_id INTEGER NOT NULL,
  read_seq    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, instance_id)
);
```

---

## 5. API-Spezifikation

### 5.1 Geräte-Pairing (QR-Code-Ablauf)

FlowVault besitzt bereits `qrcode` in `package.json`. Die Einrichtung orientiert sich an der bestehenden 2FA- und MCP-Verwaltung:

1. Admin öffnet in der Web-UI **Einstellungen → Mobile App & Benachrichtigungen**, aktiviert den Zugang (standardmäßig **aus**) und klickt **„Gerät koppeln“** (Name, optionale Instanzbeschränkung, Schwärzungsstufe).
2. `POST /api/notify/pair` erzeugt einen 128-Bit-Einmal-Code (5 Minuten gültig, nur gehasht in `pairing_codes`).
3. Die Web-UI zeigt einen QR-Code mit folgendem URI-Format (und optional manueller Code-Anzeige):
   ```text
   flowvault://pair?v=1&url=https%3A%2F%2Fflowvault.example.com&code=<einmal-code>
   ```
   *Sicherheitshinweis:* Der QR-Code enthält nur den kurzlebigen Einmal-Code, nicht das dauerhafte Token.
4. Die Android-App scannt den Code und sendet:
   ```http
   POST /mobile/v1/pair
   Content-Type: application/json

   {
     "code": "<einmal-code>",
     "deviceName": "Pixel 9 Pro",
     "platform": "android",
     "language": "de"
   }
   ```
5. `services/notify` prüft Code, Ablaufzeit und Fehlversuchslimit (max. 5 Versuche), markiert ihn als verbraucht, erzeugt ein 256-Bit-Gerätetoken `fv_app_<random>` und liefert es genau einmal zurück:
   ```json
   {
     "deviceId": 3,
     "token": "fv_app_9k2a...",
     "serverName": "FlowVault",
     "serverVersion": "0.3.11",
     "redactionMode": "lockscreen",
     "allowedInstances": null
   }
   ```
6. Die App speichert `token` verschlüsselt im Android Keystore.

### 5.2 Mobile-API (`/mobile/v1/*`)

Alle Endpunkte (außer `POST /mobile/v1/pair`) verlangen `Authorization: Bearer fv_app_…`. Der Core leitet `/mobile/v1/*` direkt an `services/notify` weiter – ohne Session-Cookie, ohne CORS, mit `Cache-Control: no-store` und IP-Rate-Limiting analog `server/mcp.ts`.

| Methode & Pfad | Zweck |
|---|---|
| `POST /mobile/v1/pair` | Einmal-Pairing-Code gegen dauerhaftes Gerätetoken tauschen |
| `GET /mobile/v1/bootstrap` | Initialzustand: Server-Info, Instanz-Kanäle (inkl. Farbe, Sync-Status, letzter Nachricht, `unreadCount`), Geräte-Regeln, `latestSeq` |
| `GET /mobile/v1/messages` | Nachrichten abfragen: `?after=<seq>` (Inkremental-Sync nach vorn) oder `?before=<seq>` (Verlauf laden), optional `instance`, `workflow`, `category=fails\|changes`, `severity`, `limit` (1–200) |
| `GET /mobile/v1/stream` | Server-Sent Events (`text/event-stream`), unterstützt `Last-Event-ID`. Sendet `event: message`, `event: message_updated` (z. B. Burst-Zähler oder nachgereichte KI-Summary), `event: read_sync`, plus `event: ping` alle 25 s |
| `POST /mobile/v1/read` | Lesestand setzen: `{ "instanceId": 2, "readSeq": 1245 }` |
| `PUT /mobile/v1/device` | Geräteeinstellungen aktualisieren: `name`, `language`, `pushType`, `pushEndpoint`, `quietHours` |
| `PUT /mobile/v1/rules` | Filter & Stummschaltung pro Instanz/Workflow speichern (`scopeType`, `scopeId`, `enabledKinds`, `mutedUntil`) |
| `POST /mobile/v1/alerts/:alertId/dismiss` | Offene Health-Warnung ausblenden (prüft `allowed_instances` des Geräts!) |
| `DELETE /mobile/v1/device` | Eigenes Gerät abmelden und Token sofort widerrufen |

#### Beispiel-Payload: `MessageItem`

```json
{
  "seq": 1245,
  "updatedSeq": 1248,
  "instance": {
    "id": 2,
    "name": "Produktion",
    "color": "#ea4b71"
  },
  "workflow": {
    "id": 19,
    "name": "Daily KPI Report"
  },
  "version": {
    "id": 88,
    "number": 14
  },
  "alertId": 7,
  "kind": "alert_opened",
  "severity": "critical",
  "title": "Fehlerquote gestiegen: Daily KPI Report (v14)",
  "body": "45 % der Läufe schlagen fehl (9/20, vorher 0 %). Betroffen: Fetch Stripe.",
  "groupCount": 1,
  "metadata": {
    "rate": 0.45,
    "total": 20,
    "failed": 9,
    "baselineRate": 0.0,
    "rollback": { "versionId": 84, "number": 13, "rate": 0.0 },
    "failingNodes": [
      {
        "name": "Fetch Stripe",
        "failed": 9,
        "rate": 0.45,
        "isNew": true,
        "lastMessage": "401 Unauthorized – Invalid API key"
      }
    ],
    "webPath": "/workflows/19"
  },
  "createdAt": 1764097200000,
  "updatedAt": 1764097500000
}
```

#### Beispiel-Payload: `workflow_changed`

```json
{
  "seq": 1249,
  "instance": { "id": 1, "name": "Staging", "color": "#4cc38a" },
  "workflow": { "id": 12, "name": "Invoice Sync" },
  "version": { "id": 91, "number": 6 },
  "kind": "workflow_changed",
  "severity": "normal",
  "title": "Invoice Sync · v6",
  "body": "„Slack“ hinzugefügt · „HTTP Request“ geändert",
  "groupCount": 1,
  "metadata": {
    "summary": {
      "added": ["Slack"],
      "removed": [],
      "modified": ["HTTP Request"],
      "renamed": [],
      "activeChanged": true,
      "nodeCount": 11
    },
    "aiSummary": {
      "title": "Slack-Benachrichtigung nach Rechnungsabruf ergänzt",
      "details": [
        "Neuer Slack-Node informiert #billing bei Fehlern",
        "HTTP-Request-Timeout auf 30 s erhöht"
      ]
    },
    "webPath": "/compare?from=85&to=91"
  },
  "createdAt": 1764098100000,
  "updatedAt": 1764098140000
}
```

### 5.3 Admin-API für FlowVault Web-UI (`/api/notify/*`)

Geschützt durch bestehendes `requireAuth` + CSRF-Prüfung in `server/index.ts`:

| Methode & Pfad | Zweck |
|---|---|
| `GET /api/notify/state` | Status (`enabled`, gekoppelte Geräte inkl. `tokenHint`, `lastSeenAt`, `pushType`, `allowedInstances`) |
| `PUT /api/notify/state` | Global ein-/ausschalten, Standard-Schwärzung & Aufbewahrungsdauer konfigurieren |
| `POST /api/notify/pair` | Einmal-Pairing-Code + QR-Code (SVG/Data-URL) erzeugen |
| `DELETE /api/notify/devices/:id` | Gerät sofort widerrufen (beendet auch aktive SSE-Verbindungen dieses Geräts) |
| `POST /api/notify/devices/:id/test` | Test-Nachricht an das Gerät senden (prüft Push + Anzeige) |

---

## 6. Messenger-UX & Android-App-Design

### 6.1 Visuelles Design (FlowVault / flown8tive Night System)

Die Android-App übernimmt das bestehende FlowVault-Designsystem (`web/src/index.css`) als Material-3-Dark-Theme (mit optionalem hellem Theme nach Systemeinstellung):

- **Hintergrund / Flächen:** `#151a23` (Night), `#1a1f29` (Panel/Nachrichten-Karte), `#232a36` (aktive Elemente/Chips)
- **Typografie:** `Archivo` für UI-Texte, `JetBrains Mono` (mit `tabular-nums`) für Versionen (`v14`), Fehlerquoten (`45 %`), Node-Namen und Fehlermeldungen
- **Akzent & Semantik:**
  - Kupfer `#c2663f` / `#e39a70` (primäre Akzente, Ungelesen-Badges)
  - Rot `#e5484d` (`alert_opened`, `execution_failed`, `sync_error`, gelöscht)
  - Gelb/Amber `#d9b44a` (`workflow_changed`, `health_poll_error`)
  - Grün `#4cc38a` (`alert_resolved`, `execution_recovered`, `workflow_created`)
  - Blau `#8aaed9` (`workflow_restored`, `workflow_promoted`)

### 6.2 Screens & Navigation

1. **Onboarding & QR-Pairing**
   - Willkommens-Screen mit „QR-Code aus FlowVault scannen“ (CameraX) und manuellem Fallback („Server-URL & Code eingeben“).
   - Zeigt Verbindungsprüfung (inkl. Hinweis bei selbst signierten Zertifikaten oder lokalen LAN-/VPN-Adressen).

2. **Chat-Übersicht (Startscreen – „Kanäle“)**
   - **Kopfzeile:** Verbindungsstatus-Indikator (Live / UnifiedPush / Offline), Suche über alle Nachrichten, Einstellungs-Icon.
   - **Schnellfilter-Leiste:** `Alle` · `Ungelesen` · `Nur Fails` · `Änderungen`
   - **Gepinnter Spezial-Kanal (nur sichtbar bei offenen Warnungen):** **„Offene Warnungen“** – bündelt alle ungelösten `alert_opened` über alle Instanzen hinweg.
   - **Instanz-Kanäle (wie Chats in Signal/WhatsApp):**
     - Farbiger Avatar-Kreis mit Instanz-Initialen (Farbe aus `instances.color`) + kleinem Health-Status-Punkt (grün/rot/grau)
     - Instanzname (z. B. *Produktion*, *Staging*)
     - Vorschau der letzten Nachricht (mit Event-Badge wie `[FAIL]` oder `[v14]`)
     - Relative Uhrzeit (`vor 3 Min.`, `14:22`, `Gestern`)
     - Kupferfarbenes Ungelesen-Badge + optional Stumm-Icon
   - **Long-Press auf Kanal:** `Als gelesen markieren`, `Stummschalten (1h / 8h / Dauerhaft)`, `Filter anpassen`.

3. **Instanz-Chat (Messenger-Ansicht)**
   - Chronologischer Nachrichtenverlauf (neueste unten, wie im Messenger) mit Tages-Trennern („Heute“, „Gestern“) und „Ungelesene Nachrichten“-Trennlinie.
   - Filter-Chip im Chat-Header: `Alle` / `Nur Fails` / `Änderungen` / `Workflow filtern`.
   - **Nachrichten-Karten:**
     - **Fail- / Alert-Karte:** Roter linker Rand, Workflow-Name + `v14`, betroffener Node in Monospace, kompakte Fehlermeldung (max. 3 Zeilen, ausklappbar), Zähler-Badge bei Bursts (`×12 · aktualisiert vor 2 Min.`), bei Health-Alerts zusätzlich Vergleich (`45 % vs. 0 % Basis`) und Hinweis (`Stabile Version: v13`). Darunter kompakte Action-Zeile: `[Im Web öffnen]` `[Ausblenden]` `[Stumm]`.
     - **Änderungs-Karte:** Gelber/grüner Rand, Workflow-Name + `v13 → v14`, KI-Titel & Stichpunkte (oder `ChangeSummary`), Badge bei Aktiv/Inaktiv-Wechsel, Action: `[Diff im Web öffnen]`.
     - **Entwarnungs-Karte:** Grüner Rand, kompakter Bezug auf vorherige Störung („Daily KPI Report: Wieder stabil nach v15“).
   - **Keine Chat-Eingabezeile** (da kein Zwei-Wege-Chat, sondern ein Monitoring-Messenger); stattdessen unten eine dezente Status-/Quick-Filter-Leiste oder „Zur neuesten Nachricht“-FAB.

4. **Nachrichten-Detail (Bottom Sheet / Detail-Screen)**
   - Vollständige Fehlermeldung (mit Ein-Tap-Kopieren), alle betroffenen Nodes mit Einzelquoten, Verlauf der letzten 10 Nachrichten genau dieses Workflows, Button **„In FlowVault öffnen“** (öffnet Chrome Custom Tab / Systembrowser direkt unter `https://<host><webPath>`).

5. **Einstellungen & Diagnose**
   - **Benachrichtigungen & Ruhezeiten:** Ruhezeiten-Zeitplan, Ausnahme für Kritisch, Link zu Android-Kanal-Einstellungen.
   - **Zustellung:** Auswahl `UnifiedPush` (zeigt erkannten Distributor + Registrierungsstatus) / `Echtzeit-Dienst` / `Periodischer Sync`, Button **„Test-Nachricht auslösen“**.
   - **Privatsphäre & Sicherheit:** Sperrbildschirm-Modus („Inhalte auf Sperrbildschirm verbergen“), optionale biometrische App-Sperre (`BiometricPrompt`).
   - **Gerät & Verbindung:** Server-URL, Instanz-Zugriff, letzter erfolgreicher Sync, „Gerät abmelden & Daten löschen“.

### 6.3 Android System-Benachrichtigungen

- **Notification Channels:**
  1. `fv_critical` – *Kritische Warnungen & Sync-Ausfälle* (`IMPORTANCE_HIGH`, Ton + Vibration)
  2. `fv_failures` – *Workflow-Fehlläufe* (`IMPORTANCE_DEFAULT`)
  3. `fv_changes` – *Workflow-Änderungen* (`IMPORTANCE_LOW`, standardmäßig leise)
  4. `fv_service` – *Echtzeit-Verbindung* (`IMPORTANCE_MIN`, nur aktiv bei Foreground Service)
- **Darstellung:** `NotificationCompat.MessagingStyle`, gruppiert pro Instanz (`setGroup("instance_<id>")`) mit automatischer Summary-Notification, sodass mehrere Meldungen einer Instanz wie ein Messenger-Thread gestapelt erscheinen.
- **Notification-Buttons (ohne App-Start):**
  - `Als gelesen` (ruft `/mobile/v1/read` im Hintergrund auf und schließt Notification)
  - `1h stumm` (setzt `mutedUntil = now + 3600_000` für den Workflow/Kanal)
  - `Warnung ausblenden` (nur bei `alert_opened`: ruft `/mobile/v1/alerts/:id/dismiss` auf)
- **Sperrbildschirm:** `VISIBILITY_PRIVATE` mit generischer öffentlicher Fallback-Notification („2 neue Meldungen in FlowVault · Produktion“), damit Fehlermeldungen auf dem gesperrten Handy nicht für Dritte lesbar sind.

---

## 7. Technischer Stack (Android)

- **Sprache & UI:** Kotlin, Jetpack Compose, Material 3
- **Architektur:** MVVM / UDF (`ViewModel` + `StateFlow`), Offline-First-Repository
- **Lokale Datenbank:** Room (SQLite) – speichert Kanäle, Nachrichten, Regeln und Lesestände lokal; die App startet sofort mit dem letzten Stand auch ohne Netz
- **Netzwerk:** OkHttp + `okhttp-sse` (SSE-Stream mit exponentiellem Backoff & `Last-Event-ID`) + Kotlinx Serialization
- **Sicherheit:** Android Keystore + Tink / EncryptedSharedPreferences für Token-Speicherung; `network_security_config.xml` erlaubt nutzerinstallierte CA-Zertifikate für Homelab-Reverse-Proxys (ohne Cleartext-HTTP standardmäßig – optionaler Warnhinweis nur für explizites LAN-Setup)
- **Push & Hintergrund:** `org.unifiedpush.android:connector` (UnifiedPush), `androidx.work:work-runtime-ktx` (WorkManager), optionaler Foreground Service (`FOREGROUND_SERVICE_REMOTE_MESSAGING` / `dataSync`)
- **QR-Scanner:** CameraX + ZXing (100 % Open Source, keine Google Play Services nötig)
- **Ablageort / Build:** Eigenes Android-Projekt in separatem Repository (`flowvault-android`) oder isoliertem Verzeichnis, sodass das Node.js-/Docker-Image von FlowVault unverändert schlank bleibt. Die Vertragstypen für `/mobile/v1/*` werden in FlowVault unter `shared/notify.ts` dokumentiert und getestet.

---

## 8. Sicherheits- & Datenschutzkonzept

1. **Keine sensiblen Workflow-Inhalte:** `services/notify` erhält keinen `APP_SECRET`, entschlüsselt keine Snapshots und liefert weder Node-Parameter noch Credentials oder n8n-API-Keys aus.
2. **Gehashte Tokens & sofortiger Widerruf:** Geräte-Tokens (`fv_app_…`, 256 Bit Entropie) werden nur als SHA-256-Hash in `notify.db` gespeichert. Widerruf in der Web-UI beendet laufende SSE-Streams dieses Geräts sofort.
3. **Sicheres Pairing:** Einmal-Codes verfallen nach 5 Minuten und nach 5 Fehlversuchen. IP-Rate-Limiting am Core (`createLoginThrottle`, IPv6 `/64`) schützt `/mobile/v1/pair` und alle Token-Aufrufe.
4. **Schwärzung (`shared/redact.ts`):** Pro Gerät konfigurierbar:
   - `lockscreen` *(Standard)*: vollständige Meldungen in der App, geschwärzte/generische Texte auf dem Sperrbildschirm.
   - `full`: alle Fehlermeldungen bereits serverseitig über `redactText()` geschwärzt (wie bei MCP), bevor sie das Handy erreichen.
   - `none`: ungeschwärzt (nur für rein interne/private Geräte).
5. **SSRF-Schutz bei UnifiedPush:** Ausgehende Wake-up-Requests nutzen strikte Validierung analog `server/net.ts`: nur `https://` (oder explizit `http://` bei privater Freigabe), keine HTTP-Redirects, Cloud-Metadaten (`169.254.0.0/16`) und Loopback blockiert. Für selbst gehostete ntfy-Instanzen im selben LAN/Docker-Netz gibt es eine explizite Opt-in-Variable `NOTIFY_ALLOW_PRIVATE_PUSH=1` (oder gezielte Host-Allowlist `NOTIFY_PUSH_ALLOWLIST`).
6. **Kein destruktiver Zugriff in v1:** Ein kompromittiertes Handy kann keine Workflows verändern, löschen oder zurücksetzen. Maximale Schreibwirkung ist `read`-Status, eigene Filter und `alert dismiss`.

---

## 9. Umsetzungsphasen (Roadmap)

### Phase 1 – FlowVault Backend & Web-UI
- `shared/notify.ts`: gemeinsame Typen & Event-Schemata
- `services/notify/`: SQLite-Schema (`notify.db`), Pairing, Token-Auth, Ingest-Endpunkt, Burst-Coalescing, SSE-Hub, UnifiedPush-Tickle-Client
- `server/internal.ts`, `server/services.ts`, `server/index.ts`: `NOTIFY_TOKEN`, `NOTIFY_PATHS`, Core-Proxy für `/mobile/v1/*` & `/api/notify/*`
- Ingest-Aufrufe in `server/sync.ts`, `server/ai.ts`, `services/health/evaluate.ts` und `services/health/poller.ts`
- Web-UI (`web/src/components/NotifySettings.tsx`): Ein/Aus, QR-Pairing-Dialog, Geräteliste, Test-Ping, Widerruf, Übersetzungen (`de` & `en`)

### Phase 2 – Android App MVP
- Projekt-Setup (Kotlin, Compose, Room, OkHttp/SSE, Keystore)
- QR-Code-Scanner + manuelles Pairing
- Chat-Übersicht (Kanäle pro Instanz) + Instanz-Chat (Fail- und Änderungs-Karten)
- SSE-Live-Updates + WorkManager-Sync + Offline-Cache
- Android Notification Channels + `MessagingStyle` + Deep-Link in FlowVault Web

### Phase 3 – Messenger-Komfort & Doze-Perfektion
- UnifiedPush-Integration (Zero-Payload Tickle → Direct Fetch) + optionaler Foreground-Service-Modus
- Notification-Direktaktionen (`Als gelesen`, `1h stumm`, `Warnung ausblenden`)
- Ruhezeiten (Quiet Hours), Pro-Workflow-Stummschaltung, Suche im Verlauf
- Stilles Nachladen von KI-Änderungstexten (`message_updated`)
- Biometrische App-Sperre & Lockscreen-Privatsphäre-Optionen

### Phase 4 – Mögliche spätere Erweiterungen (bewusst außerhalb v1)
- Mehrere FlowVault-Server parallel in einer App
- Optionales, explizit freigeschaltetes Quick-Rollback (mit eigener Geräte-Berechtigung, Biometrie und Zwei-Schritt-Bestätigung)
- Android Home-Screen-Widget (Instanz-Ampel & offene Warnungen)
- iOS-Companion-App gegen dieselbe `/mobile/v1/*`-API

---

## 10. Test- & Abnahmekriterien

### Backend-Tests (`node --test`)
- Pairing-Lebenszyklus: Gültiger Code liefert Token einmalig; abgelaufener, wiederverwendeter oder 5× falsch eingegebener Code wird abgewiesen.
- Sicherheit: Widerrufenes Token wird sofort abgewiesen; Instanz-Scope filtert Nachrichten, Kanäle, SSE und `alert dismiss` strikt; `NOTIFY_TOKEN` hat keinen Zugriff auf Snapshots oder n8n-Endpunkte.
- Coalescing: 25 identische Fehlläufe desselben Workflows+Nodes innerhalb von 10 Min. erzeugen 1 Nachricht mit `groupCount = 25`.
- Initial-Sync-Schutz: Erstimport mit > 5 Workflows erzeugt 1 Sammel-Nachricht statt Einzel-Spam.
- Redaction & SSRF: `full`-Redaction schwärzt Keys/Tokens/E-Mails; UnifiedPush-Sender lehnt `169.254.169.254` und Redirects ab.

### End-to-End-Prüfung mit `npm run mock-n8n`
FlowVault bringt bereits einen Mock-n8n-Server mit, über den alle Messenger-Szenarien lokal reproduzierbar sind:
1. `npm run dev` + `npm run mock-n8n` starten und Android-Emulator/Gerät per QR-Code koppeln.
2. `curl -X POST localhost:5679/_mock/mutate` + Sync → Änderungs-Nachricht (`workflow_changed`) erscheint im Instanz-Chat.
3. `curl -X POST localhost:5679/_mock/break` + `curl -X POST 'localhost:5679/_mock/run?n=30'` + Health-Poll → gebündelte `execution_failed`-Nachricht und kritische `alert_opened`-Karte mit Rollback-Vorschlag erscheinen als `MessagingStyle`-Notification.
4. Rollback in FlowVault Web + weitere Läufe → grüne `alert_resolved`-Entwarnung landet im Chat.
5. Flugmodus/Offline → Verlauf bleibt aus Room lesbar; nach Reconnect zieht `after=<seq>` alle verpassten Nachrichten lückenlos nach.
