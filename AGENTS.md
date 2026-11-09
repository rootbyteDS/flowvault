# Verbindliche Projektregeln

## Version bei jeder Änderung erhöhen

- Jede abgeschlossene inhaltliche Änderung erhält eine neue Projektversion. Das
  gilt auch für UI, Konfiguration, Tests und Dokumentation – in jeder Session und
  unabhängig davon, ob bereits ein Commit erstellt wird.
- Vor der Übergabe `npm run version:bump` ausführen. Der Befehl erhöht die
  Patch-Version in `package.json` und beiden Versionsfeldern von
  `package-lock.json` gemeinsam. Bei ausdrücklich gewünschtem Minor-/Major-Sprung
  stattdessen `npm version minor --no-git-tag-version` bzw. `major` verwenden.
- Die neue Versionsnummer in der abschließenden Antwort nennen. Keine Änderungen
  mit unveränderter Version als fertig melden. Kein zusätzlicher Versionssprung
  für jede einzelne Datei oder jeden Testlauf innerhalb derselben Änderung.
- `npm run version:check -- HEAD`, `npm test`, `npm run typecheck` und
  `npm run build` ausführen. Build und Tests erhöhen die Version selbst nicht.
- Den Versionshook und die CI-Prüfung nicht umgehen. Sie ergänzen diese Regel;
  der Hook allein reicht vor einer Übergabe ohne Commit nicht aus.

Details und Ausnahmen für technische Erst-Commits: [docs/VERSIONING.md](docs/VERSIONING.md).
