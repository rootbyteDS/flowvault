# Changelog

Alle für Nutzer relevanten Änderungen an FlowVault. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/). Jede Änderung erhöht die Projektversion; veröffentlicht werden nur die hier aufgeführten Releases. Ablauf: [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

### Hinzugefügt

- Dashboard-Widget „Ausführungsverlauf“ mit Tageskacheln für Fehlerquote oder Fehleranzahl, Instanzfilter und automatisch mitwachsendem Zeitraum. Es nutzt die bereits gespeicherten Ausführungen, weist abgebrochene Läufe separat aus und zeigt Abrufprobleme, Datenalter sowie möglicherweise unvollständige Historie an.

## [0.3.0] – 2026-11-10

Erstes veröffentlichtes Release. Die vorherigen Versionsnummern (0.1.0 bis 0.2.6) waren Entwicklungsstände ohne eigenes Release; ihre Änderungen sind hier zusammengefasst.

### Hinzugefügt

- Sicherung beliebig vieler n8n-Instanzen über die n8n Public API, automatisch im einstellbaren Intervall (5 Minuten bis täglich) oder manuell.
- Versionshistorie mit automatisch erzeugter Änderungsbeschreibung, eigenen Notizen und Download jeder Version als n8n-importierbares JSON. Gelöschte Workflows bleiben mit ihrer Historie erhalten.
- Visueller Diff auf dem Workflow-Canvas, Vergleich beliebiger Versionen und vollständiger JSON-Diff.
- Wiederherstellen einer Version in n8n, auch als Kopie auf einer anderen Instanz.
- Umgebungen (Staging → Produktion): ausdrücklich eingerichtete Instanzpaare und Workflow-Paarungen, Zuordnung von Credentials, Sub-/Error-Workflows, Data-Tables und Webhook-Pfaden, Drift-Ansicht und geprüfte Übernahme inklusive benötigter Abhängigkeiten.
- Health-Dienst: Fehlerquote pro Version, Warnung bei deutlichem Anstieg mit Vorschlag der letzten stabilen Version und Zurücksetzen per Klick.
- Optionale KI-Änderungstexte über Melious.
- Admin-Anmeldung mit E-Mail und Passwort sowie optionale Zwei-Faktor-Authentifizierung (TOTP) mit Wiederherstellungscodes.
- Anpassbares Dashboard mit ein- und ausblendbaren Bereichen.
- Oberfläche, Fehlermeldungen und KI-Texte auf Deutsch und Englisch; weitere Sprachen lassen sich ohne Codeänderung ergänzen.
- Archivierte Workflows werden standardmäßig übersprungen und lassen sich pro Instanz einschließen.
- Versionsnummer, Git-Commit und Build-Datum unter **Einstellungen → Über FlowVault**; Update-Anforderung über einen externen Deployment-Webhook.
- Docker-Image ohne root-Rechte sowie Compose-Dateien für Docker und Arcane.

### Sicherheit

- API-Keys und TOTP-Geheimnisse werden mit AES-256-GCM verschlüsselt; Sitzungstokens und Wiederherstellungscodes nur als SHA-256-Hash gespeichert.
- Login-Sperre pro Adresse (IPv6 pro /64-Netz) und adressübergreifend, auch gegen parallel gesendete Versuche.
- Ausgehende Requests folgen keinen Weiterleitungen; Cloud-Metadaten-Adressen sind gesperrt.
- Zugangsdaten, Webhook-Adressen und zufällig wirkende Schlüssel werden entfernt, bevor Workflow-Änderungen an die KI gehen.

[Unreleased]: https://github.com/rootbyteDS/flowvault/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/rootbyteDS/flowvault/releases/tag/v0.3.0
