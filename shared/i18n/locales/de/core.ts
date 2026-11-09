/** Grundbausteine der Oberfläche: Beschriftungen, die überall vorkommen. */
export const meta = { name: 'Deutsch', intl: 'de-DE' };

export const common = {
  save: 'Speichern',
  cancel: 'Abbrechen',
  close: 'Schließen',
  delete: 'Löschen',
  back: 'Zurück',
  pageNotFound: 'Seite nicht gefunden.',
};

export const language = {
  label: 'Sprache',
  hint: 'Gilt nur für diesen Browser.',
};

export const nav = {
  overview: 'Übersicht',
  workflows: 'Workflows',
  environments: 'Umgebungen',
  instances: 'Instanzen',
  activity: 'Aktivität',
  settings: 'Einstellungen',
  instancesHeading: 'Instanzen',
  noInstances: 'Noch keine verbunden',
  versionTitle: 'Versionsinformationen und Updates anzeigen',
  versionUnknown: 'Version unbekannt',
  versionLoading: 'Version …',
  logout: 'Abmelden',
  menu: 'Menü',
};

export const ui = {
  explanation: 'Erklärung',
  explanationFor: 'Erklärung: {label}',
  syncing: 'Sichert gerade',
  neverSynced: 'Noch nicht gesichert',
  connected: 'Verbunden',
  lastSyncFailed: 'Fehler beim letzten Sync',
};

export const time = {
  never: 'nie',
  justNow: 'gerade eben',
  manualOnly: 'Nur manuell',
  everyMinutes: 'Alle {count} Min.',
  hourly: 'Stündlich',
  everyHours: 'Alle {count} Std.',
  daily: 'Täglich',
};

/** Kurzbeschreibung einer Version, wie eine Commit-Nachricht (siehe describeSummary in web/src/util.ts). */
export const changes = {
  restoredFrom: 'Wiederhergestellt aus Version {version}',
  initial: { one: 'Erste Sicherung · {count} Node', other: 'Erste Sicherung · {count} Nodes' },
  renamedTo: 'Umbenannt in „{name}“',
  activated: 'Aktiviert',
  deactivated: 'Deaktiviert',
  added: { one: '„{name}“ hinzugefügt', other: '{count} Nodes hinzugefügt' },
  removed: { one: '„{name}“ entfernt', other: '{count} Nodes entfernt' },
  modified: { one: '„{name}“ geändert', other: '{count} Nodes geändert' },
  renamed: { one: '„{from}“ → „{to}“', other: '{count} Nodes umbenannt' },
  connections: 'Verbindungen geändert',
  settings: 'Einstellungen geändert',
  tags: 'Tags geändert',
  pinData: 'Testdaten (Pin Data) geändert',
  layout: 'Layout angepasst',
  chipInitial: 'initial',
  minor: 'Kleinere Änderungen',
};

export const auth = {
  setupTitle: 'FlowVault einrichten',
  migrationTitle: 'Admin-Konto vervollständigen',
  verifyTitle: 'Anmeldung bestätigen',
  loginTitle: 'Anmelden',
  setupText: 'Lege E-Mail und Passwort für dein Admin-Konto fest. 2FA kannst du danach in den Einstellungen aktivieren.',
  migrationText: 'Hinterlege einmalig deine E-Mail und bestätige dein bisheriges Passwort. Künftig meldest du dich mit beiden an.',
  verifyText: 'Bestätige die Anmeldung mit deiner Authenticator-App oder einem Wiederherstellungscode.',
  loginTextEmail: 'Mit E-Mail und Passwort deines Admin-Kontos.',
  loginTextLegacy: 'Mit deinem bisherigen Admin-Passwort. Danach hinterlegst du deine E-Mail.',
  recoveryCode: 'Wiederherstellungscode',
  authenticatorCode: 'Authenticator-Code',
  recoveryHint: 'Jeder Wiederherstellungscode kann nur einmal verwendet werden.',
  authenticatorHint: 'Der sechsstellige Code aus deiner App. Die Anmeldung ist fünf Minuten gültig.',
  useAuthenticator: 'Authenticator-App verwenden',
  useRecovery: 'Wiederherstellungscode verwenden',
  setupCode: 'Einrichtungscode',
  setupCodeHint: 'Steht beim Start im Server-Log, z. B. mit <code>docker logs flowvault</code>.',
  adminEmail: 'Admin-E-Mail',
  oldPassword: 'Bisheriges Passwort',
  password: 'Passwort',
  passwordPlaceholder: 'Mindestens 8 Zeichen',
  passwordRepeat: 'Passwort wiederholen',
  passwordMismatch: 'Die Passwörter stimmen nicht überein',
  submitSetup: 'Einrichten',
  submitMigration: 'Admin-Konto speichern',
  submitVerify: 'Bestätigen',
  submitLogin: 'Anmelden',
  backToLogin: 'Zurück zur Anmeldung',
};
