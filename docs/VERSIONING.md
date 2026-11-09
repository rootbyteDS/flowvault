# Versionierung

Jede abgeschlossene Änderung an FlowVault bekommt eine höhere Versionsnummer,
auch reine Änderungen an Dokumentation, Konfiguration oder Tests. Ein Versionssprung
gehört zu einer zusammenhängenden Änderung, nicht zu jedem Speichern einer Datei.

## Während der Entwicklung

```bash
npm run version:bump
npm run version:check -- HEAD
```

Der erste Befehl erhöht die Patch-Version gleichzeitig in `package.json` sowie
`version` und `packages[""].version` von `package-lock.json`. Beide Dateien gehören
zur Änderung. Für einen bewusst gewählten größeren Sprung stehen
`npm version minor --no-git-tag-version` und `npm version major --no-git-tag-version`
zur Verfügung. Das Projekt verwendet reguläre Versionen `MAJOR.MINOR.PATCH`.

`AGENTS.md` schreibt diesen Ablauf auch für zukünftige Coding-Sessions vor.
Die dortige Regel gilt bereits bei der Übergabe ohne Commit.

## Automatischer Schutz bei Commits

`npm ci` und `npm install` aktivieren über `prepare` den versionierten
`.githooks/pre-commit`. Im bestehenden Checkout kann er mit `npm run prepare`
aktiviert werden. Dafür ist keine zusätzliche Abhängigkeit erforderlich.

Sobald Änderungen vorgemerkt sind, prüft der Hook die drei Versionsfelder.
Ist die Version gegenüber `HEAD` unverändert, erhöht er die Patch-Version und
nimmt ausschließlich die beiden Paketdateien zusätzlich in den Commit auf.
Eine bereits höhere Version bleibt erhalten. Rückschritte und widersprüchliche
Versionsfelder werden abgelehnt. Bei nicht vorgemerkten Änderungen an einer
Paketdatei bricht der Hook ab, damit er keine fremden oder teilweise vorgemerkten
Änderungen versehentlich übernimmt. Die Paketdateien dann prüfen, vollständig
vormerken und den Commit erneut ausführen.

Ohne vorgemerkte Änderungen verändert der Hook nichts. Für einen technischen
Erst-Commit ohne `HEAD` gibt es keinen Vergleichsstand; dessen konsistente
Startversion wird übernommen. In Docker ohne `.git` ist die Hook-Installation
wirkungslos. Vorhandene fremde Git-Hooks werden nicht überschrieben: dort muss
`node scripts/version.ts commit` in den bestehenden pre-commit-Hook aufgenommen
werden. Die Installation weist darauf hin.

## CI und Zusammenführen

Die CI prüft zusätzlich, dass die Version höher als im Zielbranch des Pull Requests
bzw. vor dem Push auf `main` ist. Auch ein mit übersprungenem lokalem Hook erzeugter
Stand besteht diese Prüfung nur mit korrektem Versionssprung. Falls der Zielbranch
inzwischen dieselbe Versionsnummer verwendet, die eigene Version erneut erhöhen.
Ohne Vergleichsstand (erster Push oder manuell gestarteter Lauf) wird nur die
Konsistenz der drei Versionsfelder geprüft.

Die CI verändert oder committet keine Dateien. Damit die Prüfung einen Merge
verhindert, muss der Repository-Betreiber die CI-Jobs in den GitHub-Branchregeln
als erforderlich festlegen. Git-Hooks lassen sich lokal technisch umgehen; sie
sind keine Zugriffssperre.

## Anzeige und Builds

Die Anwendung liest ihre Versionsnummer weiterhin aus `package.json`. Ein neuer
Build übernimmt die erhöhte Version. Git-Commit und Build-Datum bleiben zusätzliche
Informationen. Wiederholte Builds desselben Standes erhöhen die Versionsnummer
nicht; nach Deployment bzw. Serverneustart und Neuladen zeigt die Anwendung die
neue Version. Eine bereits laufende Installation ändert sich nicht durch einen
Versionssprung im lokalen Checkout.
