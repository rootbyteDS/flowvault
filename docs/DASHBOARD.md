# Dashboard-Widgets

Über **Dashboard anpassen** lassen sich die vier Kennzahlen, der Änderungsverlauf,
der Ausführungsverlauf, die letzten Änderungen, die Instanzenübersicht sowie die Health-Warnungen einzeln
ein- und ausblenden. Die Auswahl wird erst mit **Speichern** übernommen.
**Standard wiederherstellen** setzt die Auswahl im Dialog zurück; anschließend speichern.

Über **Widgets anordnen** lässt sich die Reihenfolge direkt auf dem Dashboard
ändern. Widgets am Griff auf ein anderes Widget ziehen und dort loslassen. Das
funktioniert mit Maus, Stift und Touch; beim Ziehen am Bildschirmrand scrollt die
Seite mit. Alternativ verschieben die Pfeilknöpfe ein Widget nach vorne bzw.
hinten. Am fokussierten Griff funktionieren die Pfeiltasten sowie Pos1 und Ende.
Die Änderung wird erst mit **Speichern** serverseitig übernommen. **Abbrechen**
verwirft den Entwurf, auch nach mehreren Verschiebungen. Bei einem Speicherfehler
bleibt der Entwurf mit Fehlermeldung erhalten und kann erneut gespeichert werden.

Im gleichen Modus ändert der **Griff unten rechts** die Größe eines Widgets:
nach rechts oder links ziehen für die Breite, nach unten oder oben für die Höhe.
Die Breite rastet zwischen 3 und 12 Rasterspalten ein; die Höhe zwischen 140 und
1600 Pixeln in 20-Pixel-Schritten. Auf schmalen Bildschirmen werden Breiten passend
umgebrochen. Beim Vergrößern am Bildschirmrand scrollt die Seite mit. Reicht die
eingestellte Höhe nicht für den Inhalt, lässt dieser sich im Widget scrollen.

Am fokussierten Größen-Griff ändern Links/Rechts die Breite und Oben/Unten die
Höhe. Pos1 bzw. der Zurücksetzen-Knopf stellt die Standardgröße des Widgets wieder
her. **Automatisch** setzt nur die Höhe zurück, sodass sie wieder mit dem Inhalt
wächst. Breite und Höhe stehen während der Bearbeitung direkt am Widget.
Größen und Reihenfolge werden mit **Speichern** gemeinsam übernommen; Abbrechen
verwirft beide Entwürfe. Größen ausgeblendeter Widgets bleiben erhalten.

Die kompakte Platzierung bricht die Widgets je nach Bildschirmbreite um. Auf großen
Bildschirmen sind Kennzahlen kompakt, die beiden Verlaufswidgets jeweils eine
halbe Zeile breit; die letzten Änderungen und Instanzenübersicht teilen sich
standardmäßig eine Zeile. Kleine Widgets nutzen freie Flächen unter anderen
kurzen Widgets, auch wenn daneben eine hohe Kachel steht. Beispielsweise kann
„Versionen“ unter „Instanzen“ nachrücken, ohne auf das Ende des Ausführungsverlaufs
zu warten. Die gespeicherte Reihenfolge bestimmt die Priorität beim Platzieren;
Nachrücken kann eine spätere Kachel oberhalb einer früheren platzieren. Die
DOM- und Tastaturreihenfolge bleibt die gespeicherte Reihenfolge. Zwischenräume
im Dashboard sind beim Ziehen ebenfalls nutzbar; das nächste Ziel wird markiert.
Einträge bleiben über die bisherigen Bereiche hinweg verschiebbar.
Ein Warnungswidget ohne Warnungen ist im Anordnen-Modus über seine beschriftete
Leiste erreichbar; sonst nimmt es keinen Platz ein.

Ausgeblendete Widgets bleiben in der gespeicherten Reihenfolge und erscheinen
beim Wiedereinblenden wieder an ihrer Position. **Standardlayout** im
Anordnen-Modus setzt Reihenfolge und Größen des Entwurfs zurück. **Standard
wiederherstellen** unter **Dashboard anpassen** setzt sowohl Sichtbarkeit als
auch Reihenfolge und Größen zurück. Beide Änderungen müssen anschließend gespeichert werden.

Alle Widget-Kopfzeilen verwenden dieselben Namen wie die Auswahl unter
**Dashboard anpassen**. Beispielsweise heißt die Instanzenliste überall
**Instanzenübersicht**, während die Kennzahl **Instanzen** heißt.

Das **X** in der Kopfzeile blendet das einzelne Widget sofort für das Admin-Konto
aus. Erst wenn die Speicherung erfolgreich ist, verschwindet es. Bei einem Fehler
bleibt es sichtbar und eine Fehlermeldung erscheint. Wieder einblenden lässt es sich
über **Dashboard anpassen**, auch wenn bereits alle Widgets ausgeblendet sind.

Bei **Änderungsverlauf** und **Ausführungsverlauf** öffnet das **Zahnrad** die
Einstellungen direkt im Widget. Dort stehen Zeitraum sowie beim Ausführungsverlauf
Instanz und Darstellungsart zur Verfügung. Die aktuelle Auswahl bleibt außerhalb
des Einstellungsbereichs sichtbar. Änderungen wirken sofort und bleiben in diesem
Browser gespeichert. Erneutes Klicken auf das Zahnrad oder Escape im Bereich
schließt die Einstellungen. Widgets ohne eigene Einstellungen zeigen nur das X.

Die Einstellungen liegen serverseitig in der bestehenden SQLite-Tabelle `settings`
unter `admin_dashboard_layout`. FlowVault hat aktuell ein gemeinsames Admin-Konto;
alle angemeldeten Geräte verwenden dessen Auswahl beim Öffnen des Dashboards.
Sitzungswechsel und Änderungen der Zugangsdaten löschen sie nicht. Die bisherige
Zeitraumwahl des Änderungsverlaufs bleibt eine separate Einstellung dieses Browsers.

## Aufbau und Erweiterung

- `shared/dashboard.ts`: feste Widget-IDs, versioniertes Speicherformat, Vorgaben
  und Validierung. Fehlende IDs in älteren Einstellungen bekommen die Vorgaben
  neuer Widgets. Beschädigte Einstellungen fallen auf die Standardansicht zurück.
- `web/src/components/dashboard/DashboardGrid.tsx`: responsives Raster, Ziehen
  per Pointer Events, Scrollen am Bildschirmrand und Tastatur-/Pfeilbedienung.
- `web/src/dashboard-packing.ts`: kompakte, kollisionsfreie Platzierung aus
  gespeicherter Reihenfolge, Rasterbreite und gemessenen Widget-Höhen.
- `web/src/components/dashboard/useDashboardPacking.ts`: misst Karten per
  `ResizeObserver`, einschließlich Bearbeitungsleisten und dynamischer Inhalte.
  So werden Größenänderungen, geladene Daten und geöffnete Einstellungen
  berücksichtigt. Die äußere Höhe folgt dem tiefsten Widget; unsichtbare Warnungen
  belegen keinen Platz.
- `web/src/components/dashboard/WidgetResizeHandle.tsx`: Größen-Griff mit
  Rastereinrasten, automatischer Höhe, Standardgröße und Tastaturbedienung.
- `web/src/components/dashboard/widgets.tsx`: Widget-Komponenten und Registrierung
  mit ID. Die Standardgrößen liegen in `shared/dashboard.ts`. Die Titel in `web/src/widget-titles.ts` werden von
  Kopfzeile und Sichtbarkeitsauswahl gemeinsam verwendet. Deaktivierte Komponenten werden
  nicht eingebunden; beispielsweise ruft ein ausgeblendetes Health-Widget seine
  Warnungen nicht mehr ab.
- `web/src/components/dashboard/Heatmap.tsx`: Änderungsverlauf samt Zeitraumwahl.
- `web/src/components/dashboard/ExecutionHistory.tsx`: Ausführungsverlauf mit
  Instanzfilter, Zeitraumwahl und Fehlerquote bzw. Fehleranzahl.
- `web/src/components/dashboard/CustomizeDashboard.tsx`: Auswahl mit Entwurf,
  Speichern, Abbrechen und Zurücksetzen.
- `web/src/components/dashboard/WidgetHeader.tsx`: gemeinsame Kopfzeile mit
  Widget-Titel, Ausblenden und optionalem Einstellungsbereich.
- `server/dashboard.ts`: `GET /api/dashboard/layout` und `PUT /api/dashboard/layout`,
  sowie `PATCH /api/dashboard/layout/widgets/:id` für die Sichtbarkeit eines
  einzelnen Widgets und `PATCH /api/dashboard/layout/order` für die Reihenfolge.
  `PATCH /api/dashboard/layout/geometry` speichert Reihenfolge und Größen zusammen.
  Die Teilaktualisierungen verändern die jeweils anderen Einstellungen nicht.
  Alle liegen hinter Anmeldung und JSON-/CSRF-Schutz des Cores.

Für ein neues Widget eine ID mit Vorgabe ergänzen, die Komponente registrieren
und die Texte in beiden Sprachkatalogen ergänzen. Die Reihenfolge wird als `order`
im bestehenden Layout gespeichert; alte Einstellungen bekommen die Standardfolge.
Neue Widgets werden an vorhandene Reihenfolgen angehängt, unbekannte und doppelte
IDs beim Lesen bereinigt. Schreibzugriffe mit unbekannten oder doppelten IDs werden
abgelehnt. Alte Clients ohne `order` können ihre Sichtbarkeit weiterhin speichern,
ohne die neuere Reihenfolge oder Größen zurückzusetzen. Größen liegen unter
`sizes` im Layout; jede ID hat `columns` und `height` (null bedeutet automatische
Höhe). Alte Speicherstände bekommen Standardgrößen, beschädigte Einzelgrößen
werden auf ihre Vorgaben zurückgesetzt. Ungültige Größen in Schreibzugriffen
werden abgelehnt, ohne Teile der Anordnung zu speichern.
Für mehrere Benutzer muss die Speicherung an eine stabile Benutzer-ID gebunden
werden. Ein eigener Microservice ist für dieses Widget-System nicht erforderlich.

Die HTTP-Tests in `server/auth.test.ts` prüfen Zugriffsschutz, Speicherung über
Sitzungen, Zurücksetzen, ungültige Schreibzugriffe und ältere Speicherformate.

## Ausführungsverlauf

Das standardmäßig eingeblendete Widget zeigt Tageskacheln aus der vorhandenen
Health-Datenbank. Der neue Endpunkt `GET /api/health/executions/history` liefert
Tageszähler und Abrufstatus, optional mit `?instance=<ID>`. Die Aggregation läuft
im Health-Dienst hinter dessen internem Token und dem Login des Core-Proxys.
Sie ruft weder n8n noch Ausführungsdetails ab. Das Widget aktualisiert sich im
eingestellten Abrufintervall; ausgeblendet lädt es keine Daten.

Zeitraum (automatisch, 4 Wochen, 3/6/12 Monate), Instanz und Darstellungsart bleiben
in diesem Browser gespeichert. Automatisch wächst der Zeitraum anhand der
vorhandenen Ausführungen. Die Kacheln verwenden wie der Änderungsverlauf
UTC-Tagesgrenzen und die Startzeit der Ausführung. Fehler sind `error` und `crashed`;
die Fehlerquote ist `Fehler / (success + error + crashed)`. Abgebrochene Läufe
(`canceled`) werden separat gezählt, laufende oder wartende Läufe nicht ausgewertet.
Manuelle Testläufe folgen der bestehenden Health-Einstellung.

Die Farbstufen ändern sich nicht mit dem gewählten Zeitraum. Im Zahnrad des
Ausführungsverlaufs lassen sich für **Fehlerquote** die oberen Grenzen für Grün,
Gelb, Amber und Orange einstellen. Die Werte sind inklusive; Rot beginnt oberhalb
der Orange-Grenze. Beispielsweise färbt **Grün bis 0,3 %** Tage mit einer
Fehlerquote bis einschließlich 0,3 % grün. Ohne ausgewertete Läufe bleiben Tage
weiterhin neutral.

Gültig sind vier streng aufsteigende Prozentwerte zwischen 0 und 99,99 mit
höchstens zwei Nachkommastellen. Nur gültige Eingaben werden sofort angewendet
und mit den anderen Widget-Einstellungen in diesem Browser gespeichert. Bei
leeren oder ungültigen Eingaben erscheint ein Hinweis; Kacheln und Legende behalten
die zuletzt gültigen Grenzen. Beim Schließen werden ungültige Entwürfe verworfen.
**Farbgrenzen zurücksetzen** stellt die Standardwerte 0 / 1 / 5 / 20 % wieder her.
Vorhandene ältere Widget-Einstellungen ohne Farbgrenzen bekommen diese Standardwerte
automatisch. Bereits gespeicherte drei Grenzen für Gelb, Amber und Orange bleiben
erhalten und werden um die bisherige Grün-Grenze 0 % ergänzt.
Die Grenzen ändern nur die Darstellung, nicht die Health-Warnregeln.

Die **Fehleranzahl** behält ihre festen Zählergrenzen. Standardwerte:

| Stufe | Fehlerquote | Fehleranzahl |
| --- | --- | --- |
| Grün | 0 % bei ausgewerteten Läufen | 0 bei ausgewerteten Läufen |
| Gelb | >0 bis 1 % | 1–5 |
| Amber | >1 bis 5 % | 6–20 |
| Orange | >5 bis 20 % | 21–100 |
| Rot | >20 % | >100 |

Ohne ausgewertete Läufe bleiben Kacheln neutral, auch wenn ausschließlich
Abbrüche vorliegen. Tageswerte erscheinen bei Berührung, Mauszeiger und Fokus;
die Pfeiltasten wechseln Tage, Pos1 und Ende springen an Anfang bzw. heute.

Die Datenverfügbarkeit ist durch n8n-Speicherung, Abrufrückblick und Aufbewahrung
begrenzt (standardmäßig 14 Tage Rückblick und 30 Tage Aufbewahrung). Eine
Jahresauswahl lädt keine zusätzliche Historie nach. Fehlende Tage sind keine
Bestätigung eines fehlerfreien Betriebs. Das Widget nennt den gespeicherten
Datenzeitraum und zeigt deaktivierte Erfassung, pausierte Instanzen, ausstehende
oder fehlgeschlagene Abrufe sowie veraltete Daten an. Auch bei ausgeschalteter
Erfassung werden Daten jenseits der eingestellten Aufbewahrung nicht angezeigt.

Der Collector merkt sich zusätzlich den letzten erfolgreichen Abruf sowie
mögliche Lücken durch fehlgeschlagene Abrufe, längere Unterbrechungen oder die
bestehende Begrenzung auf 10.000 Läufe pro Durchgang. Ein später erfolgreicher
Abruf beseitigt den Lückenhinweis nicht sofort; dieser läuft mit der Aufbewahrung
aus. Die bestehende Datenbank erhält die Zusatzspalten automatisch. Historische
Erfassungsabdeckung vor dieser Erweiterung ist nicht nachträglich nachweisbar;
deshalb werden grundsätzlich nur gespeicherte Läufe ausgewiesen.
