export type AuthStatus = {
  setup: boolean;
  authenticated: boolean;
  emailLogin: boolean;
  emailRequired?: boolean;
  email?: string;
  envEmail?: boolean;
  envPassword?: boolean;
  twoFactor?: boolean;
  recoveryCodesRemaining?: number;
};

export type TwoFactorEnrollment = { secret: string; qrCode: string };
