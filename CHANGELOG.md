# Changelog

Alle für Nutzer relevanten Änderungen an FlowVault. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/). Jede Änderung erhöht die Projektversion; veröffentlicht werden nur die hier aufgeführten Releases. Ablauf: [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

### Behoben

- Beim freien Anordnen werden jetzt echte Positionen gespeichert. Widgets lassen sich gezielt in freie Spalten neben dem Ausführungsverlauf ziehen, ohne dass die automatische Sortierung sie zurücksetzt. Die Vorschau zeigt den Ablageort; überlappende Widgets weichen nach unten aus. Große und kleine Bildschirme behalten eigene Positionen. Bearbeitungsleisten liegen über den Kacheln und vergrößern sie nicht; leere Warnungen reservieren keinen Platz.

- Dashboard-Widgets nutzen freie Flächen auch neben hohen Kacheln. Beispielsweise kann „Versionen“ direkt unter den kleinen Kennzahlen stehen, während rechts der Ausführungsverlauf weiterläuft. Die Platzierung passt sich an Inhalte und Größenänderungen an; freie Zwischenräume sind beim Ziehen ebenfalls als Ablageziele nutzbar.

### Hinzugefügt

- Dashboard-Widgets lassen sich im Anordnen-Modus am Griff unten rechts in Breite und Höhe vergrößern und verkleinern, auch per Touch oder Tastatur. Größen und Reihenfolge werden gemeinsam für das Admin-Konto gespeichert. Automatische Höhe und Standardgrößen lassen sich jederzeit wiederherstellen; bei kleiner Höhe bleiben die Inhalte scrollbar.

- Zugang für KI-Agents über MCP (Model Context Protocol): Claude, ChatGPT, Cursor und andere Clients fragen unter `/mcp` nur lesend, wie es den n8n-Instanzen geht. Sechs Tools liefern ein Urteil je Instanz mit Gründen, Fehlläufe gruppiert nach Workflow, Node und Meldung, offene Warnungen, die Fehlerquote je Version, letzte Änderungen und die gesicherten Workflows. Einschalten und Tokens pro Agent anlegen unter **Einstellungen → Zugang für KI-Agents (MCP)**; Tokens lassen sich auf Instanzen beschränken und einzeln widerrufen. Der Zugang ist standardmäßig aus. Der MCP-Dienst läuft wie der Health-Dienst als eigener Prozess (`MCP_PORT`, Standard 4200, nur `127.0.0.1`).

- Dashboard-Widgets lassen sich im Modus „Widgets anordnen“ per Ziehgriff mit Maus oder Touch sowie über Pfeilknöpfe und Tastatur verschieben. Speichern übernimmt die Reihenfolge für das Admin-Konto; Abbrechen verwirft den Entwurf. Ausgeblendete Widgets behalten ihre Position.

- Dashboard-Widget „Ausführungsverlauf“ mit Tageskacheln für Fehlerquote oder Fehleranzahl, Instanzfilter und automatisch mitwachsendem Zeitraum. Es nutzt die bereits gespeicherten Ausführungen, weist abgebrochene Läufe separat aus und zeigt Abrufprobleme, Datenalter sowie möglicherweise unvollständige Historie an.

### Geändert

- Der Wiederherstellungsdialog erklärt, dass die Credential-Verweise der gewählten Version mit den heutigen Zugangsdaten verwendet werden und gelöschte oder neu angelegte Credentials in n8n neu zugewiesen werden müssen. Beim Kopieren zwischen Instanzen weist er auf die erforderlichen Zuordnungen und vorhandenen Ziel-Credentials hin.

- Die Prozentgrenzen der Farbstufen im Ausführungsverlauf lassen sich einschließlich Grün über das Zahnrad einstellen, beispielsweise Grün bis 0,3 %. Sie werden im Browser gespeichert und direkt in Kacheln und Legende übernommen. Ungültige Grenzen werden nicht angewendet; ein Zurücksetzen auf 0 / 1 / 5 / 20 % ist möglich. Bereits gespeicherte Gelb-/Amber-/Orange-Grenzen bleiben beim Update erhalten.

- Einheitliche Widget-Namen auf dem Dashboard und in „Dashboard anpassen“. Die Einstellungen der Verlaufswidgets sind über ein Zahnrad direkt am Widget erreichbar; alle Widgets lassen sich über ein X ausblenden. Das direkte Ausblenden wird für das Admin-Konto gespeichert und erhält die übrige Widget-Auswahl.

### Sicherheit

- Der MCP-Zugang gibt keine Workflow-Inhalte heraus (kein JSON, keine Parameter, kein Diff, keine KI-Texte). Fehlermeldungen und Namen werden vor der Ausgabe an Agents geschwärzt: Schlüssel und Tokens, Query-Parameter in URLs, Zugangsdaten in URLs und E-Mail-Adressen. In FlowVault selbst bleiben die Meldungen vollständig. Agent-Tokens werden nur als SHA-256 gespeichert, falsche Tokens bremst FlowVault je Adresse. Der MCP-Dienst erhält keinen Anwendungsschlüssel und ein eigenes internes Token, das der Core nur für lesende Aufrufe ohne Zugriff auf n8n annimmt.

- Workflow-Snapshots werden vollständig mit AES-256-GCM verschlüsselt gespeichert, einschließlich direkt eingetragener Secrets, Pin-Data und `staticData`. Bestehende Versionen werden vor dem ersten Serverstart transaktional verschlüsselt; anschließend werden alte Inhalte aus freien Datenbankseiten und dem SQLite-WAL bereinigt. Ein falscher Anwendungsschlüssel oder eine unvollständige Migration/Bereinigung verhindert den Start. **Vor dem Update Datenbank und bisherigen Schlüssel sichern und ausreichend freien Speicher einplanen.** Ohne ursprünglichen `APP_SECRET` bzw. `secret.key` ist die verschlüsselte Historie nicht lesbar oder wiederherstellbar; ältere Programmversionen können sie ebenfalls nicht lesen. Frühere Backups und JSON-Exporte bleiben unverändert und müssen separat geschützt werden.

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
