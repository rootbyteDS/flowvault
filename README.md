# FlowVault – Versionierung und Backup für n8n

Verbinde beliebig viele n8n-Instanzen. FlowVault sichert automatisch alle Workflows, legt bei jeder Änderung eine neue Version an und zeigt dir visuell, was sich geändert hat.

**Stand: 0.1.0, frühe Entwicklung.** FlowVault wird selbst gehostet und verwendet ein gemeinsames Admin-Passwort; getrennte Benutzerkonten und Rollen sind nicht implementiert. Das Projekt ist unabhängig von n8n und GitHub.

[Schnellstart](#schnellstart-lokal) · [Docker](#betrieb-mit-docker) · [Entwicklung](#entwicklung) · [Beiträge](CONTRIBUTING.md) · [Sicherheitsmeldungen](SECURITY.md)

## Features

- **Mehrere Instanzen**: Produktion, Staging, Kunden-Instanzen – alles an einem Ort
- **Automatische Backups** in einstellbarem Intervall (5 Min. bis täglich) oder manuell
- **Versionshistorie** wie Git-Commits, mit automatisch generierter Beschreibung („„Slack“ hinzugefügt · „HTTP Request“ geändert“) und eigenen Notizen
- **Visueller Diff**: Workflow-Canvas mit farbig markierten Nodes (neu / geändert / entfernt), Änderungen pro Node, geänderte Verbindungen, kompletter JSON-Diff
- **Beliebige Versionen vergleichen**
- **Wiederherstellen**: Version zurück nach n8n schreiben – oder als Kopie anlegen, auch auf einer anderen Instanz (Staging → Prod)
- **Umgebungen (Staging → Prod)**: Workflows zwischen Instanzen übernehmen, ohne an IDs zu scheitern – FlowVault ersetzt Credentials, Sub-Workflow-/Error-Workflow-IDs, Data-Table-IDs und Webhook-Pfade anhand einmal gespeicherter Zuordnungen. Die Drift-Ansicht zeigt, welche Workflows zwischen zwei Instanzen abweichen und in welche Richtung (siehe [Umgebungen](#umgebungen-staging--produktion))
- **Gelöschte Workflows** bleiben mit kompletter Historie erhalten
- **Welche Änderung hat es kaputt gemacht?** FlowVault holt die Ausführungen aus n8n und legt sie über die Versionshistorie: Fehlerquote pro Version („seit v14 schlagen 38 % fehl, vorher 0 %“), im Diff-Canvas rot markiert, welcher Node seit der Änderung scheitert, und bei einem Anstieg eine Warnung mit Rollback-Vorschlag. Rollback per Klick. Läuft als eigener Prozess innerhalb von FlowVault, siehe [Health-Dienst](#health-dienst-fehlerquote-pro-version)
- **Download** jeder Version als n8n-importierbares JSON
- Aktivitäts-Feed und Heatmap, Sync-Protokoll pro Instanz
- API-Keys AES-256-GCM-verschlüsselt, Login mit Passwort (siehe [Sicherheit](#sicherheit))
- **KI-Änderungstexte (optional)** über [Melious](https://melious.ai): Zu jeder neuen Version schreibt ein Modell auf EU-Infrastruktur einen Titel im Commit-Stil plus Stichpunkte. Gesendet werden nur die geänderten Nodes und Parameter – nur wenn du für eine erste Version selbst einen Text anforderst, der ganze Workflow. Werte von Feldern wie `password`, `token`, `apiKey` oder `Authorization` sowie typische Key-Formate (Bearer, JWT, `sk_…`, `ghp_…`, AWS) entfernt FlowVault vorher. Das ist eine Heuristik: Zugangsdaten gehören in n8n-Credentials, nicht in Code-Nodes. Einrichtung unter **Einstellungen → KI-Änderungstexte**.

Nur echte Änderungen erzeugen Versionen – Laufzeitdaten wie `staticData` (z. B. Polling-Zeitstempel) werden ignoriert.

## Schnellstart (lokal)

Voraussetzung: **Node.js ≥ 22.18** (empfohlen 24). Keine Datenbank nötig – SQLite ist eingebaut.

Klone dieses Repository zunächst mit der URL aus **Code → SSH/HTTPS** auf GitHub und wechsle in den Projektordner. Führe dort aus:

```bash
npm ci
npm run build
npm start            # → http://127.0.0.1:4000
```

Beim ersten Aufruf legst du ein Admin-Passwort fest und verbindest dann deine erste Instanz. Dafür brauchst du den **Einrichtungscode**, den der Server beim Start ins Terminal schreibt – so kann niemand anderes eine frisch gestartete Instanz übernehmen.

### n8n-API-Key besorgen

In n8n: **Settings → n8n API → Create an API key**. Der Key braucht Lesezugriff auf Workflows (für das Wiederherstellen und Übernehmen auch Schreibzugriff). Für die Fehlerquoten werden zusätzlich Leserechte auf Ausführungen benötigt. Ob die Public API und einzelne Berechtigungen verfügbar sind, hängt von deiner n8n-Installation ab.

## Entwicklung

Nach `npm ci` startest du die Entwicklung mit `npm run dev`. Den Mock und die folgenden Testbefehle führst du jeweils in einem weiteren Terminal aus. In FlowVault verbindest du den Mock über `http://localhost:5679` mit dem API-Key `test-key`; eine echte n8n-Instanz ist dafür nicht nötig.

```bash
npm run dev          # API (Port 4000, startet den Health-Dienst mit) + Vite-Frontend (http://localhost:5173)
npm run mock-n8n     # Fake-n8n auf Port 5679, API-Key: test-key, erzeugt laufend Ausführungen
MOCK_ENV=Prod MOCK_PORT=5680 npm run mock-n8n   # zweite Fake-Instanz mit eigenen IDs – für Umgebungen (Staging → Prod)
curl -X POST localhost:5679/_mock/mutate   # simuliert eine Workflow-Änderung
curl -X POST localhost:5679/_mock/break    # Änderung, nach der ein Node in 40 % der Läufe scheitert
curl -X POST 'localhost:5679/_mock/run?n=30'  # sofort 30 Läufe pro aktivem Workflow
npm test             # Tests der Umgebungs-Zuordnungen und der Health-Auswertung
# Der Mock spielt auch Melious: API-Adresse http://localhost:5679/v1, Key test-ai-key
MOCK_LOG_PROMPT=1 npm run mock-n8n          # zeigt, was an die KI gesendet würde
npm run typecheck
```

## Betrieb mit Docker

```bash
cp .env.example .env
openssl rand -base64 32
```

Trage den erzeugten Wert in `.env` hinter `APP_SECRET=` ein. Die Datei und den Schlüssel aufbewahren; bei einer bestehenden Installation den Schlüssel nicht neu erzeugen. Dann starten:

```bash
docker compose up -d --build
docker compose logs flowvault  # zeigt den Einrichtungscode für das Admin-Passwort
```

Der Port ist nur auf `127.0.0.1` freigegeben. Von außen erreichbar machst du FlowVault über einen Reverse Proxy mit HTTPS (Caddy, Traefik, nginx) – dann **`TRUST_PROXY=1` setzen**, sonst zählen alle Login-Versuche für die IP des Proxys. Läuft FlowVault im selben Docker-Netzwerk wie n8n, kannst du als URL z. B. `http://n8n:5678` eintragen.

Der Container läuft als Benutzer `node` (UID 1000). Ein Volume aus einer älteren Version (lief als root) einmalig übergeben. Über Compose wird dabei das tatsächlich verwendete Volume angesprochen, auch wenn sein Name einen Projekt-Präfix enthält:

```bash
docker compose stop flowvault
docker compose run --rm --no-deps --user root --entrypoint chown flowvault -R 1000:1000 /data
docker compose up -d
```

## Konfiguration

| Variable         | Standard     | Beschreibung |
|------------------|--------------|--------------|
| `PORT`           | `4000`       | HTTP-Port |
| `HOST`           | `127.0.0.1`  | Bind-Adresse (`0.0.0.0` im Container) |
| `DATA_DIR`       | `./data`     | Speicherort für Datenbank & Schlüssel |
| `APP_SECRET`     | –            | Schlüssel für die API-Key-Verschlüsselung. Ohne: wird automatisch in `data/secret.key` erzeugt |
| `ADMIN_PASSWORD` | –            | Festes Admin-Passwort statt Einrichtung im Browser |
| `TRUST_PROXY`    | –            | `1` hinter einem Reverse Proxy (Pflicht, sonst greift die Login-Sperre für alle) |
| `HEALTH_PORT`    | `4100`       | Interner Port des Health-Dienstes (nur `127.0.0.1`, nie nach außen) |

Docker Compose liest `.env` für die in `docker-compose.yml` referenzierten Variablen. Weitere Einstellungen müssen dort unter `environment` ergänzt werden. Beim direkten Start über npm wird `.env` nicht automatisch geladen: Variablen in der Shell setzen, z. B. `PORT=4001 HEALTH_PORT=4101 npm start` (macOS/Linux).

FlowVault startet den Health-Dienst selbst als Kindprozess und startet ihn nach einem Absturz neu. Fällt er aus, läuft FlowVault normal weiter, nur ohne Betriebsdaten. Core und Dienst teilen sich ein internes Token, das automatisch in `data/internal.token` liegt.

## Umgebungen: Staging → Produktion

Kopieren zwischen Instanzen scheitert in der Praxis an IDs, die überall anders sind: Credentials („Slack Staging“ ↔ „Slack Prod“), Sub-Workflow-IDs in Execute Workflow, Error-Workflows in den Settings, Data-Table-IDs, Webhook-Pfade. **Umgebungen** unterstützt diese Übernahme über die n8n Public API mit eigenen Zuordnungen:

- **Zuordnungen einmal speichern** (Umgebungen → Zuordnungen), pro Richtung (Staging → Prod und zurück getrennt). **Vorschläge** erkennt Gegenstücke automatisch: Credentials über die n8n Public API (der API-Key braucht dafür Lesezugriff auf Credentials) bzw. Namen ohne Umgebungszusatz, Sub-Workflows über die ohnehin gesicherten Workflows, Data-Tables und Webhook-Pfade aus den gespeicherten Snapshots.
- **Drift-Ansicht**: welche Workflows weichen zwischen den Instanzen ab – gemessen am Stand *nach* Anwendung der Zuordnungen – und welche Seite die neuere Änderung hat. „Diff“ zeigt je Workflow, was eine Übernahme ändern würde.
- **Übernehmen** überschreibt den Ziel-Workflow (der bisherige Stand bleibt als Version gesichert) oder legt ihn neu – inaktiv – an. Auch das Kopieren aus der Versionshistorie auf eine andere Instanz wendet dieselben Zuordnungen an.
- Fehlende Zuordnungen zeigt FlowVault vor der Übernahme an; betroffene IDs bleiben dann unverändert.

Workflow-Paarungen (Quell-ID ↔ Ziel-ID) merkt sich FlowVault bei jeder Übernahme selbst – die Zuordnung übersteht also auch Umbenennungen. Zugangsdaten bleiben verschlüsselt: Die Ziel-Instanz wird nur über ihre gespeicherte Adresse und ihren eigenen API-Key erreicht.

## Health-Dienst: Fehlerquote pro Version

GitHub sieht nur den Code, nicht den laufenden Betrieb. FlowVault verbindet beides: Jede Ausführung aus n8n wird der Workflow-Version zugeordnet, die zu dem Zeitpunkt lief.

- **Zuordnung**: Maßgeblich ist der Speicherzeitpunkt in n8n (`updatedAt`), nicht der Zeitpunkt der Sicherung. Liefert n8n eine `workflowVersionId` an der Ausführung, wird sie bevorzugt. Speicherst du zwischen zwei Sicherungen mehrfach, landen die Läufe dazwischen bei der vorherigen gesicherten Version. Ein kürzeres Sync-Intervall macht die Zuordnung genauer.
- **Bewertung**: Eine Version wird erst ab einer Mindestzahl Läufe bewertet (Standard 5). Verglichen wird mit den Versionen davor. Steigt die Fehlerquote um mindestens 20 Prozentpunkte, gibt es eine Warnung auf der Übersicht und beim Workflow, mit Vorschlag der letzten stabilen Version. Zurückgesetzt wird nur auf Klick, nie automatisch.
- **Testläufe** aus dem Editor (`mode: manual`) zählen standardmäßig nicht.
- **Datensparsam**: Der Core reduziert jede Ausführung auf Status, Zeit, Modus, Node-Name und Fehlermeldung, bevor er sie weitergibt. Ein- und Ausgabedaten verlassen den Core nie. API-Keys auch nicht: Der Health-Dienst holt die Ausführungen über die interne API des Cores, nicht direkt bei n8n.
- **Grenzen**: Pro Abruf höchstens 10.000 Ausführungen und 200 Fehler mit Details je Instanz. Sehr aktive Instanzen holen ältere Läufe beim ersten Abruf daher nicht vollständig nach. Der n8n-API-Key braucht Lesezugriff auf Executions.

Alle Schwellenwerte stehen unter **Einstellungen → Fehlerquote pro Version**.

## Sicherheit

Wer in FlowVault angemeldet ist, kann Workflows in alle verbundenen n8n-Instanzen schreiben. Deshalb:

- **Einrichtung nur mit Code** aus dem Server-Log. Nach 5 falschen Versuchen (Login wie Einrichtung) sperrt FlowVault die IP mit wachsender Wartezeit.
- **Sitzungen**: HttpOnly-Cookie mit `SameSite=Strict`, in der Datenbank nur als SHA-256 gespeichert. Ein Passwortwechsel meldet alle anderen Geräte ab.
- **CSRF**: Schreibende Requests nur von der eigenen Seite (`Sec-Fetch-Site`/`Origin`) und nur als JSON.
- **API-Keys** verlassen FlowVault nur zur gespeicherten Adresse. Wird die URL einer Instanz oder der KI-API geändert, muss der Key neu eingegeben werden. Weiterleitungen werden nicht verfolgt, Cloud-Metadaten-Adressen (169.254.x.x) sind gesperrt.
- **Header**: strikte Content-Security-Policy, kein Einbetten in fremde Seiten, HSTS hinter HTTPS-Proxy.
- **Dateien** in `DATA_DIR` sind nur für den Benutzer lesbar, unter dem FlowVault läuft.
- **Schriften** werden lokal ausgeliefert, der Browser lädt nichts von Drittanbietern.

Gut zu wissen: Die Snapshots enthalten auch Pin-Data (Testdaten) und `staticData` der Workflows. Sie liegen komprimiert, aber nicht verschlüsselt in der Datenbank – bei personenbezogenen Testdaten die Datenbank entsprechend schützen.

## Backup von FlowVault selbst

Sichere `flowvault.db` (SQLite, alle Versionen gzip-komprimiert) aus `DATA_DIR` und den verwendeten Schlüssel: entweder `secret.key` aus demselben Verzeichnis oder den Wert von `APP_SECRET` aus deiner Betriebskonfiguration. **Datenbank und Schlüssel zusammen sichern** – ohne Schlüssel müssen die API-Keys neu eingetragen werden, die Workflow-Versionen bleiben aber lesbar.

Für eine einfache Dateikopie FlowVault vorher stoppen (`docker compose stop flowvault` bzw. den lokalen Server beenden). Im laufenden Betrieb keine isolierte Kopie von `flowvault.db` anlegen: SQLite verwendet zusätzlich WAL-Dateien. Danach FlowVault wieder starten.

`health.db` enthält abgeleitete Ausführungsdaten, Warnungen und die Einstellungen des Health-Dienstes. Vorhandene Ausführungen können erneut aus n8n geladen werden, soweit n8n sie noch gespeichert hat. Sichere die Datei ebenfalls, wenn du Einstellungen und Warnungszustände erhalten möchtest.

## Architektur

```
server/          Node.js + Express (TypeScript, läuft nativ ohne Build)
  index.ts       REST-API & Auslieferung des Frontends
  sync.ts        Sync-Engine, Scheduler, Wiederherstellen
  n8n.ts         Client für die n8n Public API
  internal.ts    Interne API für Dienste (Token) + Weiterleitung /api/health → Health-Dienst
  ai.ts          KI-Änderungstexte über Melious, Warteschlange, Secret-Filter
  promote/        Umgebungen (Staging → Prod): ID-Zuordnungen, Drift-Ansicht, Übernahme
    transform.ts  Ersetzt IDs in Snapshots – rein funktional + Tests
    mappings.ts  Zuordnungs-Speicher, Vorschläge, Workflow-Paarung
    drift.ts      Abweichungen zwischen zwei Instanzen
    promote.ts    Übernahme auf die Ziel-Instanz
    router.ts     HTTP-API des Moduls (/api/promote)
  db.ts          SQLite-Schema (node:sqlite)
  crypto.ts      Verschlüsselung, Passwort-Hashing, Kompression
  services.ts    Startet und überwacht den Health-Dienst (Kindprozess)
services/health/ Health-Dienst: Ausführungen ↔ Versionen, Fehlerquoten, Warnungen
  index.ts       HTTP-API (nur für den Core)
  poller.ts      Holt Ausführungen über den Core
  analysis.ts    Reine Auswertung (Zuordnung, Fehlerquote, Rollback-Vorschlag) + Tests
  evaluate.ts    Verknüpft Auswertung mit Versionen, pflegt Warnungen
  db.ts          Eigene SQLite-Datenbank (health.db)
shared/diff.ts   Workflow-Vergleich (Server & Browser)
shared/executions.ts  Ausführungen reduzieren, Typen für Core, Dienst & Browser
web/             React + Tailwind (Vite)
scripts/         Mock-n8n zum Testen
```

## Beiträge und GitHub

Hinweise für Entwicklung, Fehlermeldungen und Pull Requests stehen in [CONTRIBUTING.md](CONTRIBUTING.md). Die GitHub Actions unter [`.github/workflows/ci.yml`](.github/workflows/ci.yml) prüfen Tests, TypeScript und den Frontend-Build mit Node.js 22.18 und 24.

Die Schritte für die erste Veröffentlichung dieses Repositorys stehen in [docs/GITHUB.md](docs/GITHUB.md). Sicherheitsprobleme bitte gemäß [SECURITY.md](SECURITY.md) vertraulich melden.

## Lizenz

FlowVault steht unter der [MIT-Lizenz](LICENSE). Abhängigkeiten unterliegen ihren jeweiligen Lizenzen.
