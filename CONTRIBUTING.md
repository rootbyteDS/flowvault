# Zu FlowVault beitragen

FlowVault ist in früher Entwicklung und steht unter der [MIT-Lizenz](LICENSE). Besprich größere Änderungen zunächst in einem Issue, damit Ziel und Umfang klar sind. Beiträge zum Projektcode erfolgen ebenfalls unter dieser Lizenz.

## Lokal entwickeln

Voraussetzung: Node.js ≥ 22.18, empfohlen 24, sowie npm.

```bash
npm ci
npm run dev
```

In einem zweiten Terminal kannst du `npm run mock-n8n` starten. Verbinde in FlowVault `http://localhost:5679` mit dem API-Key `test-key`. Der Mock hält seine Testdaten im Arbeitsspeicher; ein Neustart setzt sie zurück. Weitere Befehle stehen in der [README](README.md#entwicklung).

## Änderungen prüfen

Jede abgeschlossene Änderung braucht eine höhere Projektversion. Mit
`npm run version:bump` die Patch-Version in beiden Paketdateien erhöhen und mit
`npm run version:check -- HEAD` prüfen. Der Git-Hook übernimmt einen vergessenen
Versionssprung vor dem Commit; die CI prüft zusätzlich gegen den Vergleichsstand.
Details: [Versionierung](docs/VERSIONING.md).

Vor einem Pull Request:

```bash
npm test
npm run typecheck
npm run build
```

Für Verhaltensänderungen ergänze passende Tests, soweit sie den Fehler oder das neue Verhalten sinnvoll absichern. Bei UI-Änderungen beschreibe, wie du sie im Browser geprüft hast. Passe die Dokumentation an, wenn sich Einrichtung oder Bedienung ändern.

## Übersetzungen

Texte der Oberfläche und des Servers liegen unter `shared/i18n/locales/`. Neue Texte zuerst auf Deutsch anlegen und in jeder Sprache ergänzen; `npm run typecheck` und `npm test` melden fehlende Schlüssel und abweichende Platzhalter. Wie eine weitere Sprache hinzukommt, steht in [docs/I18N.md](docs/I18N.md).

## Issues und Pull Requests

- Fehler: Version/Commit, Node.js- oder Docker-Version, erwartetes und tatsächliches Verhalten sowie reproduzierbare Schritte nennen.
- Vorschläge: das konkrete Problem und den gewünschten Ablauf beschreiben.
- Pull Requests: Problem, Änderung und durchgeführte Prüfungen knapp erklären. Änderungen auf ein nachvollziehbares Thema begrenzen.

Nutze ausschließlich erfundene oder bereinigte Beispieldaten. Keine `.env`-Dateien, API-Keys, Datenbanken, produktiven Workflow-Exporte oder unbereinigten Logs und Screenshots anhängen. Bei Sicherheitslücken gilt [SECURITY.md](SECURITY.md).
