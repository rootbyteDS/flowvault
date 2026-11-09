export type AuthStatus = {
  setup: boolean;
  authenticated: boolean;
  emailLogin: boolean;
  /** Sprache des Servers (`DEFAULT_LANGUAGE`) – Ausweichsprache der Oberfläche. */
  defaultLanguage?: string;
  emailRequired?: boolean;
  email?: string;
  envEmail?: boolean;
  envPassword?: boolean;
  twoFactor?: boolean;
  recoveryCodesRemaining?: number;
};

export type TwoFactorEnrollment = { secret: string; qrCode: string };
