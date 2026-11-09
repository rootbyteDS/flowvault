# Dashboard-Widgets

Über **Dashboard anpassen** lassen sich die vier Kennzahlen, der Änderungsverlauf,
die letzten Änderungen, die Instanzenübersicht sowie die Health-Warnungen einzeln
ein- und ausblenden. Die Auswahl wird erst mit **Speichern** übernommen.
**Standard wiederherstellen** setzt die Auswahl im Dialog zurück; anschließend speichern.

Die Einstellungen liegen serverseitig in der bestehenden SQLite-Tabelle `settings`
unter `admin_dashboard_layout`. FlowVault hat aktuell ein gemeinsames Admin-Konto;
alle angemeldeten Geräte verwenden dessen Auswahl beim Öffnen des Dashboards.
Sitzungswechsel und Änderungen der Zugangsdaten löschen sie nicht. Die bisherige
Zeitraumwahl des Änderungsverlaufs bleibt eine separate Einstellung dieses Browsers.

## Aufbau und Erweiterung

- `shared/dashboard.ts`: feste Widget-IDs, versioniertes Speicherformat, Vorgaben
  und Validierung. Fehlende IDs in älteren Einstellungen bekommen die Vorgaben
  neuer Widgets. Beschädigte Einstellungen fallen auf die Standardansicht zurück.
- `web/src/components/dashboard/widgets.tsx`: Widget-Komponenten und Registrierung
  mit ID, übersetztem Titel und Layoutbereich. Deaktivierte Komponenten werden
  nicht eingebunden; beispielsweise ruft ein ausgeblendetes Health-Widget seine
  Warnungen nicht mehr ab.
- `web/src/components/dashboard/Heatmap.tsx`: Änderungsverlauf samt Zeitraumwahl.
- `web/src/components/dashboard/CustomizeDashboard.tsx`: Auswahl mit Entwurf,
  Speichern, Abbrechen und Zurücksetzen.
- `server/dashboard.ts`: `GET /api/dashboard/layout` und `PUT /api/dashboard/layout`,
  hinter der bestehenden Anmeldung und dem JSON-/CSRF-Schutz des Cores.

Für ein neues Widget eine ID mit Vorgabe ergänzen, die Komponente registrieren
und die Texte in beiden Sprachkatalogen ergänzen. Das Dashboard ordnet die sichtbaren
Bereiche ohne leere Seitenleiste an. Reihenfolge und Größen sind derzeit fest;
zusätzliche Einstellungen können später im versionierten Layout ergänzt werden.
Für mehrere Benutzer muss die Speicherung an eine stabile Benutzer-ID gebunden
werden. Ein eigener Microservice ist für dieses Widget-System nicht erforderlich.

Die HTTP-Tests in `server/auth.test.ts` prüfen Zugriffsschutz, Speicherung über
Sitzungen, Zurücksetzen, ungültige Schreibzugriffe und ältere Speicherformate.
