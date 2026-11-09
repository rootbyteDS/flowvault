import type { Messages } from '../../types.ts';

export const account: Messages['account'] = {
  loading: 'Loading admin account …',
  proof: {
    password: 'Current password',
    factor: 'Authenticator or recovery code',
    factorHint: 'Use a new code for every confirmation. App codes change every 30 seconds.',
  },
  email: {
    title: 'Admin account',
    text: 'One admin account for this FlowVault installation. The email is used to sign in; no emails are sent.',
    fromEnv: '{email} – set via <code>ADMIN_EMAIL</code>.',
    save: 'Save email',
    changed: 'Admin email changed. Other devices were signed out.',
  },
  password: {
    title: 'Change password',
    fromEnv: 'The password is set via <code>ADMIN_PASSWORD</code>.',
    new: 'New password',
    repeat: 'Repeat new password',
    save: 'Save password',
    changed: 'Password changed. Other devices were signed out.',
  },
  recovery: {
    intro:
      'These ten codes are only shown now. Keep them safe and separate from your password. Each code replaces the authenticator code once; your password is still required.',
    download: 'Download codes',
    confirm: 'I have saved the recovery codes safely.',
    done: 'Done',
    fileTitle: 'FlowVault – recovery codes',
    fileText: 'Each code can only be used once. Keep them safe, separate from your password.',
    fileName: 'flowvault-recovery-codes.txt',
  },
  twoFactor: {
    title: 'Two-factor authentication',
    on: 'On',
    off: 'Not enabled',
    text: 'Protect your admin account with an authenticator app as well. No email delivery is needed for that.',
    setupTitle: 'Set up 2FA',
    disableTitle: 'Disable 2FA',
    recoveryTitle: 'Renew recovery codes',
    scan: 'Scan the QR code with your authenticator app and confirm with the code it shows. The setup is valid for ten minutes.',
    qrAlt: 'QR code for setting up FlowVault in an authenticator app',
    manualKey: 'Key for manual entry',
    recoveryWarning: 'All previous recovery codes become invalid. The new codes are shown only once.',
    createQr: 'Create QR code',
    enable: 'Enable 2FA',
    disable: 'Disable 2FA',
    newCodes: 'Create new codes',
    newCodesButton: 'New recovery codes',
    codesRemaining: {
      one: '{count} recovery code left. If you lose your phone, you can still access your account with it.',
      other: '{count} recovery codes left. If you lose your phone, you can still access your account with them.',
    },
    disabled: '2FA disabled. Other devices were signed out.',
    enabled: '2FA enabled. Save your recovery codes now.',
    codesCreated: 'New codes created. All previous codes are invalid.',
  },
};

export const system: Messages['system'] = {
  title: 'About FlowVault',
  reload: 'Reload',
  loading: 'Loading version information …',
  version: 'Installed version',
  commit: 'Git commit',
  noCommit: 'Not recorded in the build',
  modified: 'with local changes',
  builtAt: 'Build created',
  updates: 'Updates',
  hookConnected: 'Update trigger connected',
  manual: 'Manual update',
  textEnabled:
    'Request an update from your deployment service. FlowVault is briefly unavailable while the container is replaced. Whether a newer version is available is not checked automatically here.',
  textInvalid: 'The connection to the update service is configured incorrectly. Please check the deployment configuration.',
  textManual:
    'With Docker/Arcane, you install updates through a new build followed by a deployment. For the update button, a deployment webhook has to be connected once.',
  accepted:
    'Update request accepted at {time}. That confirms the trigger, not yet the installation. Check the history in your deployment service and reload FlowVault afterwards.',
  reloadApp: 'Reload FlowVault',
  requestNow: 'Request update now',
  request: 'Request update',
  openDeployment: 'Open deployment ↗',
  guide: 'Update guide ↗',
};
