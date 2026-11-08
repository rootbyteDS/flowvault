# FlowVault auf GitHub veröffentlichen

## Vor dem ersten Push

- Zielkonto bzw. Organisation und Repository-Namen festlegen, z. B. `flowvault`.
- Sichtbarkeit wählen: öffentlich oder privat.
- Die [MIT-Lizenz](../LICENSE) ist für den Projektcode bereits hinterlegt. Vor der Veröffentlichung den Copyright-Vermerk prüfen.
- Für ein öffentliches Projekt einen privaten Kontaktweg für Sicherheitsmeldungen festlegen und [SECURITY.md](../SECURITY.md) entsprechend ergänzen.
- Optional: einen Screenshot mit ausschließlich Mock-Daten zur README hinzufügen.

Im Projektordner prüfen:

```bash
npm ci
npm test
npm run typecheck
npm run build
git status --short --untracked-files=all
git add --dry-run .
```

`.gitignore` hält unter anderem `data/`, lokale `.env`-Varianten, Datenbanken und Schlüsseldateien aus neuen Commits heraus. `.env.example` gehört dagegen ins Repository. Prüfe trotzdem den Inhalt aller Dateien für den ersten Commit: Ignorierregeln erkennen keine Zugangsdaten innerhalb von Quellcode, Workflow-JSON oder Dokumentation und wirken nicht auf bereits versionierte Dateien.

## Repository verbinden und pushen

Erstelle im gewünschten GitHub-Konto ein **leeres Repository**. Lass die Optionen zum Erzeugen von README, `.gitignore` und Lizenz zunächst leer, da die Projektdateien lokal vorbereitet sind.

Dieses lokale Verzeichnis ist bereits ein Git-Repository auf `main`. Für den ersten Commit:

```bash
git add .
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "Initial commit: FlowVault"
```

Verbinde danach das Repository. Ersetze `DEIN-ACCOUNT` und gegebenenfalls `flowvault` durch die tatsächlichen Werte. Das SSH-Beispiel setzt einen bei GitHub hinterlegten SSH-Key voraus; alternativ nutze die HTTPS-URL aus dem Repository:

```bash
git remote add origin git@github.com:DEIN-ACCOUNT/flowvault.git
git push -u origin main
```

## Nach dem Push

- Im Tab **Actions** prüfen, ob der Workflow `CI` auf beiden Node.js-Versionen erfolgreich ist. Er führt Tests, TypeScript-Prüfung und Frontend-Build aus.
- Repository-Beschreibung ergänzen, z. B. „Self-hosted version history, backups and visual diffs for n8n workflows“.
- Bei öffentlicher Sichtbarkeit vertrauliche Sicherheitsmeldungen aktivieren und den Meldeweg aus [SECURITY.md](../SECURITY.md) prüfen.
- Bei gemeinsamer Entwicklung den Schutz von `main` und verpflichtende CI-Prüfungen einrichten, soweit im gewählten GitHub-Tarif verfügbar.

Ein Tag oder Release für `v0.1.0` kann danach separat erstellt werden. Ein veröffentlichtes Container-Image oder ein automatischer Deployment-Prozess ist in diesem Repository bislang nicht eingerichtet.
