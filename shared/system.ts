export type BuildInfo = {
  version: string;
  revision: string | null;
  modified: boolean;
  builtAt: string | null;
};

export type UpdateInfo = {
  enabled: boolean;
  reason: 'not_configured' | 'invalid_configuration' | null;
  managementUrl: string | null;
};

export type SystemInfo = BuildInfo & { updates: UpdateInfo };
