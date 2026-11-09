/** Einstellungsseite: Sprache, Fehlerquote (Health), KI-Texte, Hinweise. Konto und System: siehe account.ts. */
export const settings = {
  title: 'Einstellungen',
  language: {
    title: 'Sprache',
    text: 'Sprache der Oberfläche. Die Wahl gilt nur für diesen Browser. Die Sprache der KI-Änderungstexte stellst du unter „KI-Änderungstexte“ ein.',
  },
  health: {
    title: 'Fehlerquote pro Version',
    titleTip:
      'Für jede gesicherte Version zählt FlowVault, wie viele Ausführungen in n8n danach gescheitert sind.\n\nSo siehst du direkt in der Versionshistorie, <b>welche Änderung etwas kaputt gemacht hat</b>, an welchem Node es scheitert und auf welche Version du zurück kannst.',
    noResponse: 'Antwortet nicht',
    on: 'Aktiv',
    off: 'Aus',
    intro:
      'Zeigt bei jeder Version, wie oft der Workflow danach in n8n gescheitert ist, und warnt, wenn eine Änderung etwas kaputt gemacht hat. Das kann ein Git-Repository nicht: Es kennt nur den Code, nicht den laufenden Betrieb.',
    unavailable:
      'Die Auswertung der Ausführungen antwortet gerade nicht. FlowVault startet sie automatisch neu, versuch es in ein paar Sekunden noch einmal. Bleibt es dabei, steht der Grund im Server-Log. Versionen, Vergleich und Wiederherstellen funktionieren weiter.',
    perInstance: 'Abruf je Instanz',
    perInstanceTip:
      'Pro verbundener n8n-Instanz: wann FlowVault zuletzt Ausführungen geholt hat und wie viele gespeichert sind.\n\n<b>Grüner Punkt</b>: letzter Abruf hat geklappt. <b>Roter Punkt</b>: fehlgeschlagen, der Grund steht darunter. Der nächste Abruf versucht es automatisch erneut.',
    nothingPolled: 'Noch nichts abgerufen. Sobald eine Instanz verbunden ist, startet der erste Abruf von selbst.',
    pollingOff: 'Der Abruf ist ausgeschaltet.',
    stored: {
      one: '<n>{formatted}</n> Ausführung gespeichert · abgerufen {when}',
      other: '<n>{formatted}</n> Ausführungen gespeichert · abgerufen {when}',
    },
    firstPoll: 'Erster Abruf läuft',
    whenToWarn: 'Wann warnen?',
    example: {
      one: 'Beispiel mit diesen Werten: Lief ein Workflow vorher mit {example} % Fehlern, warnt FlowVault ab {threshold} %, sobald die neue Version mindestens {count} Lauf hatte.',
      other: 'Beispiel mit diesen Werten: Lief ein Workflow vorher mit {example} % Fehlern, warnt FlowVault ab {threshold} %, sobald die neue Version mindestens {count} Läufe hatte.',
    },
    alerts: 'Warnen und Rollback vorschlagen',
    alertsHint: 'Auf der Übersicht und beim Workflow. Zurückgesetzt wird nie automatisch, nur auf deinen Klick.',
    alertsTip:
      'Die Warnung erscheint auf der Übersicht und oben auf der Workflow-Seite, zusammen mit der letzten Version, die stabil lief.\n\nSie verschwindet von selbst, wenn du zurücksetzt oder eine neuere Version wieder normal läuft. Blendest du sie aus, kommt sie für dieselbe Version nicht wieder, für eine spätere schon.\n\nAus: Die Fehlerquote wird weiter angezeigt und auffällige Versionen werden rot markiert, nur ohne Warnung.',
    threshold: 'Anstieg ab (Prozentpunkte)',
    thresholdHint: 'Kleiner = empfindlicher, mehr Warnungen',
    thresholdTip:
      '<b>Prozentpunkte, nicht Prozent</b>: Von 5 % auf 25 % Fehler sind 20 Prozentpunkte.\n\nVerglichen wird die Fehlerquote der neuen Version mit der der Versionen davor. Liegt sie mindestens so viel höher, gilt die Version als auffällig.\n\nGut zum Start: 20. Bei Workflows, die nie scheitern dürfen, eher 5 bis 10.',
    minRuns: 'Mindestens Läufe',
    minRunsHint: 'Wenige Läufe sind Zufall. Darunter wird nur angezeigt, nicht bewertet.',
    minRunsTip:
      'Bei 2 Läufen mit einem Fehler wären es schon 50 %. Deshalb bewertet FlowVault eine Version erst ab dieser Zahl abgeschlossener Läufe. Für die Versionen davor gilt dieselbe Grenze.\n\nSeltene Workflows, z. B. einmal täglich, brauchen entsprechend Tage, bis sie bewertet werden. Dort lohnt ein kleinerer Wert.',
    manual: 'Testläufe aus dem Editor mitzählen',
    manualHint: 'Meist aus: Beim Bauen scheitern Testläufe oft mit Absicht.',
    manualTip:
      '<b>Testläufe</b> startest du im n8n-Editor mit „Execute workflow“ oder „Test step“.\n\n<b>Produktivläufe</b> kommen von Triggern, Webhooks, Zeitplänen oder anderen Workflows. Nur die sagen etwas darüber, ob der Workflow im Betrieb funktioniert.',
    storage: 'Abruf und Speicher',
    storageText:
      'Gespeichert werden nur Status, Zeit und bei Fehlern Node-Name und Meldung, in <code>data/health.db</code>. Ein- und Ausgabedaten nie. Der API-Key der Instanz braucht Lesezugriff auf Executions.',
    enabled: 'Ausführungen regelmäßig abrufen',
    enabledHint: 'Aus: keine neuen Daten, die bisherigen bleiben sichtbar.',
    enabledTip:
      'Schaltet die ganze Funktion: An fragt FlowVault regelmäßig bei jeder Instanz nach neuen Ausführungen.\n\nAus: Es werden keine neuen geholt und keine neuen Warnungen erzeugt. Schon gespeicherte Ausführungen bleiben, bis du wieder einschaltest.',
    pollMinutes: 'Alle (Minuten)',
    pollMinutesHint: 'Kürzer = Warnung kommt schneller',
    pollMinutesTip:
      'Wie oft FlowVault neue Ausführungen holt. Eine Warnung kann frühestens beim nächsten Abruf kommen.\n\nKürzere Abstände erzeugen etwas mehr Anfragen an n8n, sind aber für die meisten Instanzen kein Problem. 5 Minuten passen meistens.',
    lookback: 'Rückblick (Tage)',
    lookbackHint: 'Beim ersten Abruf. n8n löscht alte Läufe oft selbst.',
    lookbackTip:
      'So weit zurück holt FlowVault Ausführungen, vor allem beim ersten Abruf einer neuen Instanz.\n\nWas n8n schon gelöscht hat, ist nicht mehr abrufbar. n8n räumt standardmäßig nach 14 Tagen auf (Executions Pruning).',
    retention: 'Aufbewahren (Tage)',
    retentionHint: 'Danach löscht FlowVault sie',
    retentionTip:
      'So lange behält FlowVault Ausführungen in seiner eigenen Datenbank, auch wenn n8n sie längst gelöscht hat.\n\nÄltere fallen raus, damit verschwindet auch die Fehlerquote sehr alter Versionen. Der Wert ist mindestens so groß wie der Rückblick.',
    pollNow: 'Jetzt abrufen',
    pollNowTitle: 'Holt sofort neue Ausführungen aller Instanzen und wertet sie aus',
    discard: 'Änderungen verwerfen',
    saved: 'Gespeichert. Gilt ab der nächsten Auswertung.',
    polled: 'Ausführungen abgerufen und ausgewertet',
  },
  ai: {
    title: 'KI-Änderungstexte mit Melious',
    active: 'Aktiv · <m>{model}</m>',
    off: 'Aus',
    intro:
      'Melious schreibt zu jeder neuen Version einen kurzen Änderungstext. Die Modelle laufen auf EU-Infrastruktur, Melious trainiert nicht mit deinen Daten. Gesendet werden nur die geänderten Nodes und Parameter. Nur wenn du für eine erste Version selbst einen Text anforderst, geht der ganze Workflow raus. Werte von Feldern wie password, token oder apiKey sowie typische Key-Formate (Bearer, JWT, sk_…, ghp_…) entfernt FlowVault vorher. Das ist eine Heuristik – fest im Code hinterlegte Zugangsdaten gehören in n8n-Credentials.',
    apiKey: 'API-Key',
    keyKept: 'Gespeichert ({hint}). Leer lassen, um ihn zu behalten.',
    keyHint: 'Unter <a>melious.ai</a> erstellen. Wird verschlüsselt gespeichert.',
    model: 'Modell',
    modelsLoaded: { one: '{count} Modell geladen', other: '{count} Modelle geladen' },
    modelsLoadHint: 'Mit „Verbindung testen“ die verfügbaren Modelle laden',
    baseUrl: 'API-Adresse',
    baseUrlHint: 'Standard: https://api.melious.ai/v1. Bei einer neuen Adresse muss der API-Key erneut eingegeben werden.',
    language: 'Sprache der Texte',
    languageHint: 'Die KI schreibt die Änderungstexte in dieser Sprache. Bereits erzeugte Texte bleiben unverändert.',
    use: 'KI-Texte verwenden',
    useHint: 'Schaltet die Anbindung insgesamt an oder aus',
    auto: 'Automatisch für neue Versionen',
    autoHint: 'Sonst nur auf Knopfdruck in der Versionsansicht',
    test: 'Verbindung testen',
    changeUrl: 'API-Adresse ändern',
    connected: { one: 'Verbunden, {count} Modell verfügbar', other: 'Verbunden, {count} Modelle verfügbar' },
    saved: 'KI-Einstellungen gespeichert',
    queued: { one: '{count} Version in der Warteschlange', other: '{count} Versionen in der Warteschlange' },
    pending: { one: '<n>{count}</n> Text wird gerade erzeugt', other: '<n>{count}</n> Texte werden gerade erzeugt' },
    missing: {
      one: '<n>{count}</n> bestehende Version hat noch keinen KI-Text',
      other: '<n>{count}</n> bestehende Versionen haben noch keinen KI-Text',
    },
    backfill: 'Nachholen',
  },
  how: {
    title: 'So arbeitet FlowVault',
    pull: 'Pro Instanz werden alle Workflows über die n8n Public API abgeholt.',
    versions:
      'Eine neue Version entsteht nur, wenn sich Inhalt, Name, Status, Tags oder Einstellungen ändern – reine Laufzeitdaten (staticData) werden ignoriert.',
    deleted: 'In n8n gelöschte Workflows bleiben mit ihrer kompletten Historie erhalten.',
    keys:
      'API-Keys werden mit AES-256-GCM verschlüsselt gespeichert. Den Schlüssel (<code>data/secret.key</code> bzw. <code>APP_SECRET</code>) unbedingt mitsichern.',
    health:
      'Für die Fehlerquote pro Version speichert FlowVault von jeder Ausführung nur Status, Zeit und bei Fehlern Node und Meldung (<code>data/health.db</code>).',
    ai: 'KI-Texte (optional) erzeugt Melious. Ohne API-Key verlässt kein Workflow-Inhalt FlowVault.',
    data: 'Alle Daten liegen in <code>data/flowvault.db</code> (SQLite).',
  },
};
