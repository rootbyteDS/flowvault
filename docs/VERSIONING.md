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

## Changelog

[`CHANGELOG.md`](../CHANGELOG.md) beschreibt Änderungen für Nutzer und Betreiber im
Format „Keep a Changelog“. Jede für sie sichtbare Änderung bekommt im selben Commit
einen Eintrag unter `## [Unreleased]`, eingeordnet in `### Hinzugefügt`, `### Geändert`,
`### Behoben`, `### Entfernt` oder `### Sicherheit`. Einträge beschreiben die Wirkung
(„Login-Sperre gilt auch für parallele Versuche“), nicht die Umsetzung. Rein interne
Änderungen wie Refactoring, Tests oder CI-Anpassungen brauchen keinen Eintrag.
Hinweise für bestehende Installationen, etwa neue Pflicht-Variablen oder
Migrationen, gehören immer hinein.

Nicht jede Versionsnummer ist ein Release: Die Patch-Version steigt mit jeder
Änderung, der Changelog führt nur veröffentlichte Releases. `npm run changelog:check`
prüft den Aufbau (Abschnitt `[Unreleased]` zuerst, Versionen mit Datum, absteigend
sortiert, keine Version über der Projektversion); die CI führt die Prüfung ebenfalls aus.

## Release veröffentlichen

Ein Release ist ein bewusst gesetzter Stand auf `main`. Vorbereitung als eigener Commit:

1. Version festlegen: `npm version minor --no-git-tag-version` für neue Funktionen,
   `patch` für reine Korrekturen, `major` ab 1.0 für inkompatible Änderungen.
2. In `CHANGELOG.md` die Überschrift `## [Unreleased]` in
   `## [X.Y.Z] – JJJJ-MM-TT` umbenennen, darüber einen neuen leeren Abschnitt
   `## [Unreleased]` anlegen und die Links am Dateiende ergänzen:
   ```
   [Unreleased]: https://github.com/rootbyteDS/flowvault/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/rootbyteDS/flowvault/compare/vVORHER...vX.Y.Z
   ```
3. `npm run changelog:check`, `npm test`, `npm run typecheck` und `npm run build`
   ausführen, committen, auf `main` pushen und die CI abwarten.
4. Tag setzen und pushen:
   ```bash
   git tag -a vX.Y.Z -m "FlowVault X.Y.Z"
   git push origin vX.Y.Z
   ```

Der Workflow [`release.yml`](../.github/workflows/release.yml) prüft dann, dass der Tag
auf `main` liegt und zur Version in `package.json` passt, führt Tests, TypeScript-Prüfung
und Build aus und erstellt das GitHub-Release mit dem Abschnitt der Version aus dem
Changelog als Text. Schlägt eine Prüfung fehl, entsteht kein Release; nach der Korrektur
den Tag löschen (`git push --delete origin vX.Y.Z`, `git tag -d vX.Y.Z`) und neu setzen.
Den Text eines bestehenden Releases zeigt `node scripts/changelog.ts notes X.Y.Z`.

## Anzeige und Builds

Die Anwendung liest ihre Versionsnummer weiterhin aus `package.json`. Ein neuer
Build übernimmt die erhöhte Version. Git-Commit und Build-Datum bleiben zusätzliche
Informationen. Wiederholte Builds desselben Standes erhöhen die Versionsnummer
nicht; nach Deployment bzw. Serverneustart und Neuladen zeigt die Anwendung die
neue Version. Eine bereits laufende Installation ändert sich nicht durch einen
Versionssprung im lokalen Checkout.
