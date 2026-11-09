import type { Messages } from '../../types.ts';

export const meta: Messages['meta'] = { name: 'English', intl: 'en-GB' };

export const common: Messages['common'] = {
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  delete: 'Delete',
  back: 'Back',
  pageNotFound: 'Page not found.',
};

export const language: Messages['language'] = {
  label: 'Language',
  hint: 'Applies to this browser only.',
};

export const nav: Messages['nav'] = {
  overview: 'Overview',
  workflows: 'Workflows',
  environments: 'Environments',
  instances: 'Instances',
  activity: 'Activity',
  settings: 'Settings',
  instancesHeading: 'Instances',
  noInstances: 'None connected yet',
  versionTitle: 'Show version information and updates',
  versionUnknown: 'Version unknown',
  versionLoading: 'Version …',
  logout: 'Sign out',
  menu: 'Menu',
};

export const ui: Messages['ui'] = {
  explanation: 'Explanation',
  explanationFor: 'Explanation: {label}',
  syncing: 'Backing up now',
  neverSynced: 'Not backed up yet',
  connected: 'Connected',
  lastSyncFailed: 'Last sync failed',
};

export const time: Messages['time'] = {
  never: 'never',
  justNow: 'just now',
  manualOnly: 'Manual only',
  everyMinutes: 'Every {count} min',
  hourly: 'Hourly',
  everyHours: 'Every {count} hours',
  daily: 'Daily',
};

export const changes: Messages['changes'] = {
  restoredFrom: 'Restored from version {version}',
  initial: { one: 'Initial backup · {count} node', other: 'Initial backup · {count} nodes' },
  renamedTo: 'Renamed to “{name}”',
  activated: 'Activated',
  deactivated: 'Deactivated',
  added: { one: '“{name}” added', other: '{count} nodes added' },
  removed: { one: '“{name}” removed', other: '{count} nodes removed' },
  modified: { one: '“{name}” changed', other: '{count} nodes changed' },
  renamed: { one: '“{from}” → “{to}”', other: '{count} nodes renamed' },
  connections: 'Connections changed',
  settings: 'Settings changed',
  tags: 'Tags changed',
  pinData: 'Test data (pin data) changed',
  layout: 'Layout adjusted',
  chipInitial: 'initial',
  minor: 'Minor changes',
};

export const auth: Messages['auth'] = {
  setupTitle: 'Set up FlowVault',
  migrationTitle: 'Complete the admin account',
  verifyTitle: 'Confirm sign-in',
  loginTitle: 'Sign in',
  setupText: 'Choose an email and password for your admin account. You can enable 2FA afterwards in the settings.',
  migrationText: 'Set your email once and confirm your current password. From now on you sign in with both.',
  verifyText: 'Confirm the sign-in with your authenticator app or a recovery code.',
  loginTextEmail: 'With the email and password of your admin account.',
  loginTextLegacy: 'With your previous admin password. Afterwards you set your email.',
  recoveryCode: 'Recovery code',
  authenticatorCode: 'Authenticator code',
  recoveryHint: 'Each recovery code can only be used once.',
  authenticatorHint: 'The six-digit code from your app. The sign-in is valid for five minutes.',
  useAuthenticator: 'Use authenticator app',
  useRecovery: 'Use a recovery code',
  setupCode: 'Setup code',
  setupCodeHint: 'Printed in the server log at startup, e.g. via <code>docker logs flowvault</code>.',
  adminEmail: 'Admin email',
  oldPassword: 'Current password',
  password: 'Password',
  passwordPlaceholder: 'At least 8 characters',
  passwordRepeat: 'Repeat password',
  passwordMismatch: 'The passwords do not match',
  submitSetup: 'Set up',
  submitMigration: 'Save admin account',
  submitVerify: 'Confirm',
  submitLogin: 'Sign in',
  backToLogin: 'Back to sign-in',
};
