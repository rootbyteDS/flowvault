/** Fehlerquote pro Version: Erklärungen, Versions-Panel, Warnungen. */
export const health = {
  runs: { one: '{count} Lauf', other: '{count} Läufe' },
  range: { single: 'v{to}', span: 'v{from} bis v{to}' },
  pollError: {
    unauthorized: 'Der API-Key wird von n8n abgelehnt',
    unauthorizedFix: 'Trag bei der Instanz einen gültigen API-Key ein.',
    forbidden: 'Der API-Key darf keine Ausführungen lesen',
    forbiddenFix: 'Erstelle in n8n unter Settings → n8n API einen Key mit Lesezugriff auf Executions und trag ihn bei der Instanz ein.',
    unreachable: 'Die n8n-Instanz ist nicht erreichbar',
    unreachableFix: 'Läuft n8n und stimmt die URL? Der nächste Abruf versucht es automatisch erneut.',
  },
  steps: {
    fetch: 'Ausführungen abholen',
    fetchText:
      'Alle {minutes} Min. fragt FlowVault bei n8n nach neuen Ausführungen. Gespeichert werden nur Status, Zeit und bei Fehlern der Node mit Meldung. Ein- und Ausgabedaten nie.',
    assign: 'Der Version zuordnen',
    assignText:
      'Jede Ausführung zählt für die Version, die zu dem Zeitpunkt in n8n gespeichert war. So hat jede Version ihre eigene Fehlerquote.',
    compare: 'Mit vorher vergleichen',
    compareOn:
      'Hat eine neue Version mindestens {runs} und liegt ihre Fehlerquote {threshold} Prozentpunkte oder mehr über den Versionen davor, warnt FlowVault und schlägt die letzte stabile Version vor. Zurückgesetzt wird nur auf deinen Klick.',
    compareOff:
      'Hat eine neue Version mindestens {runs} und liegt ihre Fehlerquote {threshold} Prozentpunkte oder mehr über den Versionen davor, wird sie markiert. Warnungen sind gerade aus. Zurückgesetzt wird nur auf deinen Klick.',
  },
  explainer: {
    label: 'Wie wird das berechnet?',
    rateWithManual:
      '<h>Fehlerquote</h> = gescheiterte Läufe ÷ abgeschlossene Läufe dieser Version. Abgebrochene und noch laufende Ausführungen zählen nicht.',
    rateWithoutManual:
      '<h>Fehlerquote</h> = gescheiterte Läufe ÷ abgeschlossene Läufe dieser Version, ohne Testläufe aus dem Editor. Abgebrochene und noch laufende Ausführungen zählen nicht.',
    compare:
      '<h>Vergleich</h>: die bis zu fünf Versionen davor zusammen, bis mindestens {runs} beisammen sind. Gewarnt wird ab {threshold} Prozentpunkten Anstieg, z. B. von {from} % auf {to} %.',
    assign:
      '<h>Zuordnung</h>: nach dem Speicherzeitpunkt in n8n. Speicherst du zwischen zwei Sicherungen mehrmals, zählen die Läufe dazwischen zur vorherigen gesicherten Version.',
    unattributed: {
      one: '{count} Lauf fand vor der ersten Sicherung statt und gehört zu keiner Version.',
      other: '{count} Läufe fanden vor der ersten Sicherung statt und gehören zu keiner Version.',
    },
    lastPoll: 'Zuletzt abgerufen {when}.',
    changeThresholds: 'Schwellenwerte ändern',
  },
  pill: {
    tip: {
      one: '{failed} von {total} Lauf mit dieser Version fehlgeschlagen',
      other: '{failed} von {total} Läufen mit dieser Version fehlgeschlagen',
    },
    early: ' (vorläufig, bewertet wird ab {min})',
    regression: '. Deutlich mehr als vorher.',
    errors: '{rate} Fehler',
    provisional: 'vorläufig',
  },
  nodes: {
    where: 'Wo es scheitert',
    whereTip:
      'Der Node, an dem die Ausführung abgebrochen ist, mit der letzten Fehlermeldung aus n8n. Die Prozentzahl bezieht sich auf alle Läufe dieser Version.\n\nDetails holt FlowVault für höchstens 200 Fehler pro Abruf. Bei sehr vielen Fehlern können die Zahlen pro Node daher etwas niedriger sein als die Gesamtquote.',
    line: '<n>„{name}“</n><m> in {rate} der Läufe ({failed}×)</m>',
    isNew: 'neu seit dieser Version',
    isNewTip:
      'In den Versionen davor ist dieser Node fast nie gescheitert, in höchstens 2 % der Läufe.\n\nEin starker Hinweis, dass die Änderung in dieser Version die Ursache ist. Schau dir im Tab „Änderungen“ an, was an diesem Node anders ist.',
    canvas: 'Auf dem Canvas sind diese Nodes rot umrandet.',
  },
  panel: {
    unavailable: 'Fehlerquote gerade nicht verfügbar',
    unavailableHint: 'FlowVault startet die Auswertung automatisch neu. Versionen, Vergleich und Wiederherstellen funktionieren weiter.',
    disabled: 'Fehlerquote pro Version ist ausgeschaltet',
    disabledHint: 'Zeigt pro Version, wie oft der Workflow in n8n gescheitert ist. <link>Einschalten</link>',
    pollFailed: 'Ausführungen konnten nicht abgerufen werden: {reason}',
    lastGood: 'Letzter erfolgreicher Stand {when}.',
    firstPoll: 'FlowVault holt gerade zum ersten Mal die Ausführungen aus n8n',
    firstPollHint: 'Das dauert meist unter einer Minute. Die Seite aktualisiert sich von selbst.',
    whyInactive: 'Der Workflow ist in n8n nicht aktiv.',
    whyManual: 'Testläufe aus dem Editor zählen nicht mit.',
    whyLookback: 'Abgerufen werden Ausführungen der letzten {days} Tage, sofern n8n sie noch hat.',
    noRunsPast: 'Solange v{number} aktuell war, gab es keine gezählten Läufe',
    noRunsYet: 'Mit v{number} gab es noch keine gezählten Läufe',
    provisional: 'Vorläufig: erst {total} von {min} Läufen. Ab {min} vergleicht FlowVault mit den Versionen davor.',
    provisionalLabel: 'Vorläufig',
    provisionalTip:
      'Bei wenigen Läufen schwankt die Quote stark: Ein Fehler bei 2 Läufen sind schon 50 %.\n\nDeshalb gibt es erst ab {runs} eine Bewertung und eine mögliche Warnung. Die Grenze stellst du in den Einstellungen ein.',
    noBase: 'Kein Vergleich möglich: Vor v{number} gab es zu wenige gezählte Läufe.',
    noBaseLabel: 'Kein Vergleich möglich',
    noBaseTip:
      'Für einen Vergleich brauchen auch die Versionen davor zusammen mindestens {runs}.\n\nDas passiert bei der ersten Version, bei selten laufenden Workflows oder wenn n8n ältere Ausführungen schon gelöscht hat.',
    fewer: 'Weniger Fehler als vorher.',
    slightlyMore: 'Etwas mehr Fehler als vorher, aber unter der Warnschwelle von {threshold} Prozentpunkten.',
    same: 'Unauffällig, ungefähr wie vorher.',
    since: 'Seit v{number} schlagen {rate} der Läufe fehl',
    failedShare: '{rate} der Läufe fehlgeschlagen',
    rateLabel: 'Fehlerquote',
    rateTip:
      '<b>Fehlerquote</b> = gescheiterte ÷ abgeschlossene Läufe, solange diese Version in n8n aktuell war.\n\n{manual} Abgebrochene und noch laufende Ausführungen zählen nicht.',
    manualCounted: 'Testläufe aus dem Editor zählen mit.',
    manualNotCounted: 'Testläufe aus dem Editor zählen nicht mit.',
    before: ', vorher {rate} ({range})',
    beforeLabel: 'Vergleich mit vorher',
    beforeTip:
      '<b>Vergleichsbasis</b>: die Versionen direkt davor, zusammengenommen, bis mindestens {runs} beisammen sind. Höchstens fünf Versionen zurück.\n\nHier: {range} mit {total}, davon {failed} gescheitert.',
    counts: '{failed}/{runs}',
    canceledSuffix: ' · {count} abgebrochen',
    canceledLabel: 'abgebrochen',
    canceledTip: 'Von Hand gestoppte Ausführungen. Sie zählen weder als Erfolg noch als Fehler.',
    rollbackHint:
      'v{number} ist die letzte Version, die stabil lief ({rate} Fehler). Zurücksetzen spielt sie in n8n ein, der jetzige Stand bleibt hier gesichert.',
    rollbackLabel: 'Rollback-Vorschlag',
    rollbackTip:
      'FlowVault sucht rückwärts die jüngste Version, deren Fehlerquote nah an der Zeit vor der Änderung lag.\n\nBeim Klick siehst du vorher noch einmal, was passiert: überschreiben oder als Kopie anlegen. Danach entsteht eine neue Version, die Historie bleibt komplett.',
    rollbackButton: 'Auf v{number} zurücksetzen',
  },
  alert: {
    dismissTip: 'Blendet die Warnung für diese Version aus. Steigt die Fehlerquote einer späteren Version, warnt FlowVault erneut.',
    title: 'Seit der Änderung in v{number} scheitert dieser Workflow deutlich öfter',
    whyLabel: 'Warum diese Warnung?',
    why1: 'FlowVault vergleicht die Fehlerquote der aktuellen Version mit den Versionen davor.',
    whyDetail: 'Liegt sie nach mindestens {runs} um {threshold} Prozentpunkte oder mehr darüber, erscheint diese Warnung.',
    why2: 'Die Warnung verschwindet von selbst, sobald eine neuere Version wieder normal läuft oder du zurücksetzt.',
    body: '{rate} der Läufe schlagen fehl ({failed} von {total}), vorher waren es {baseline}. Erkannt {when}.',
    bodyNode: '{rate} der Läufe schlagen fehl ({failed} von {total}), vorher waren es {baseline}. Meist scheitert „{name}“. Erkannt {when}.',
    look: 'Sieh dir an, was sich in v{number} geändert hat.',
    lookUrgent: 'Sieh dir an, was sich in v{number} geändert hat. Wenn es eilt: v{rollback} lief zuletzt stabil.',
    dismiss: 'Ausblenden',
    dismissedVersion: 'Warnung für v{number} ausgeblendet',
    dismissed: 'Warnung ausgeblendet',
    viewChange: 'Änderung ansehen',
    cardTitle: { one: 'Ein Workflow scheitert seit einer Änderung öfter', other: '{count} Workflows scheitern seit einer Änderung öfter' },
    howDetected: 'Wie wird das erkannt?',
    cardText: 'Die Fehlerquote der aktuellen Version liegt deutlich über der vorherigen. Öffne den Workflow, um die Änderung zu sehen.',
    row: '{instance} · seit v{number}: <r>{rate}</r> Fehler statt {baseline}',
    rowNode: ' · meist „{name}“',
    rollbackTitle: 'v{number} lief zuletzt stabil',
  },
};
