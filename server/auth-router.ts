import { Router, type Request, type Response, type NextFunction } from 'express';
import QRCode from 'qrcode';
import {
  adminEmail, checkPassword, consumeSetupCode, createSession, destroyAllSessions, destroySession,
  isAuthenticated, isSetUp, loginFailed, loginSucceeded, loginThrottle, readCookie, requireAuth,
  requireSession, sessionHash, setAuthCookie,
} from './auth.ts';
import { decrypt, encrypt, hashPassword, randomToken, safeEqual, sha256 } from './crypto.ts';
import { db, getSetting, setSetting, tx } from './db.ts';
import {
  consumeSecondFactor, newRecoveryCodes, newTotpSecret, recoveryHashes, totp, totpCounter, twoFactorEnabled,
} from './two-factor.ts';

import { updates, type createUpdateService } from './updates.ts';

const LOGIN_COOKIE = 'fv_login';
const LOGIN_TTL = 5 * 60_000;
const ENROLL_TTL = 10 * 60_000;
type Challenge = { token: string; secret_enc: string | null; attempts: number };

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function emailInput(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse eingeben');
  return email;
}

function passwordInput(value: unknown) {
  const password = String(value ?? '');
  if (password.length < 8 || password.length > 1024) fail(400, 'Passwort muss zwischen 8 und 1024 Zeichen haben');
  return password;
}

function clearLogin(req: Request, res: Response) {
  const token = readCookie(req, LOGIN_COOKIE);
  if (token) db.prepare('DELETE FROM auth_challenges WHERE token = ? AND kind = ?').run(sha256(token), 'login');
  setAuthCookie(req, res, LOGIN_COOKIE, '', 0);
}

function rotateSession(req: Request, res: Response) {
  destroyAllSessions();
  clearLogin(req, res);
  createSession(req, res);
}

/** Separate router so the full authentication boundary can be tested without n8n/services. */
export function createAuthRouter(clientIp: (req: Request) => string, updateService: ReturnType<typeof createUpdateService> = updates) {
  const router = Router();
  const ip = (req: Request) => `auth:${clientIp(req)}`;
  function throttle(req: Request, _res: Response, next: NextFunction) {
    const wait = loginThrottle(ip(req));
    if (wait) fail(429, `Zu viele Versuche – bitte ${wait}s warten`);
    next();
  }
  const revision = () => getSetting('auth_revision') ?? '';

  function assertFresh(req: Request, proof: string) {
    if (!isAuthenticated(req) || proof !== revision()) fail(401, 'Sitzung abgelaufen – bitte erneut anmelden');
  }

  async function reauthenticate(req: Request, factor = true) {
    const before = revision();
    const valid = await checkPassword(String(req.body?.current ?? ''));
    assertFresh(req, before);
    if (!valid || (factor && twoFactorEnabled() && !consumeSecondFactor(String(req.body?.factor ?? '')))) {
      loginFailed(ip(req));
      fail(401, 'Passwort oder Sicherheitscode ist falsch bzw. bereits verwendet');
    }
    return before;
  }

  router.get('/status', (req, res) => {
    const authenticated = isAuthenticated(req);
    res.json({
      setup: isSetUp(), authenticated, emailLogin: !!adminEmail(),
      ...(authenticated ? {
        emailRequired: !adminEmail(), email: adminEmail(), envEmail: !!process.env.ADMIN_EMAIL,
        envPassword: !!process.env.ADMIN_PASSWORD, twoFactor: twoFactorEnabled(), recoveryCodesRemaining: recoveryHashes().length,
      } : {}),
    });
  });

  router.post('/setup', throttle, async (req, res) => {
    if (isSetUp()) fail(409, 'Bereits eingerichtet');
    const email = emailInput(req.body?.email);
    if (process.env.ADMIN_EMAIL && email !== adminEmail()) fail(400, 'E-Mail muss der konfigurierten ADMIN_EMAIL entsprechen');
    const password = passwordInput(req.body?.password);
    if (!consumeSetupCode(String(req.body?.code ?? ''))) {
      loginFailed(ip(req));
      fail(403, 'Einrichtungscode falsch – er steht im Server-Log');
    }
    const hashed = await hashPassword(password);
    if (isSetUp()) fail(409, 'Bereits eingerichtet');
    tx(() => {
      setSetting('admin_password', hashed);
      setSetting('admin_email', email);
      rotateSession(req, res);
    });
    loginSucceeded(ip(req));
    res.json({ ok: true });
  });

  router.post('/login', throttle, async (req, res) => {
    const before = revision();
    const valid = await checkPassword(String(req.body?.password ?? ''));
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!valid || (adminEmail() && !safeEqual(email, adminEmail())) || before !== revision()) {
      loginFailed(ip(req));
      fail(401, 'E-Mail oder Passwort ist falsch');
    }
    clearLogin(req, res);
    if (twoFactorEnabled()) {
      destroySession(req, res);
      db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(Date.now());
      const token = randomToken();
      db.prepare('INSERT INTO auth_challenges (token, kind, expires_at) VALUES (?, ?, ?)').run(sha256(token), 'login', Date.now() + LOGIN_TTL);
      setAuthCookie(req, res, LOGIN_COOKIE, token, LOGIN_TTL);
      return res.json({ twoFactorRequired: true });
    }
    loginSucceeded(ip(req));
    createSession(req, res);
    res.json({ ok: true });
  });

  router.post('/login/verify', throttle, (req, res) => {
    const token = readCookie(req, LOGIN_COOKIE);
    const challenge = token ? db.prepare("SELECT * FROM auth_challenges WHERE token = ? AND kind = 'login' AND expires_at > ?").get(sha256(token), Date.now()) as Challenge | undefined : undefined;
    if (!challenge) fail(401, 'Anmeldung abgelaufen – bitte erneut mit E-Mail und Passwort anmelden');
    if (!consumeSecondFactor(String(req.body?.factor ?? ''))) {
      db.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE token = ?').run(challenge.token);
      loginFailed(ip(req));
      if (challenge.attempts >= 4) clearLogin(req, res);
      fail(401, challenge.attempts >= 4 ? 'Zu viele falsche Codes – bitte erneut mit E-Mail und Passwort anmelden' : 'Sicherheitscode ist falsch oder bereits verwendet');
    }
    clearLogin(req, res);
    loginSucceeded(ip(req));
    createSession(req, res);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    destroySession(req, res);
    clearLogin(req, res);
    res.json({ ok: true });
  });

  router.use(requireSession);

  // Also used for the one-time migration of old password-only installations.
  router.post('/email', throttle, async (req, res) => {
    if (process.env.ADMIN_EMAIL) fail(400, 'E-Mail wird über ADMIN_EMAIL gesetzt');
    const email = emailInput(req.body?.email);
    const proof = await reauthenticate(req);
    assertFresh(req, proof);
    tx(() => {
      setSetting('admin_email', email);
      rotateSession(req, res);
    });
    loginSucceeded(ip(req));
    res.json({ ok: true });
  });

  router.use(requireAuth);

  router.post('/update', throttle, async (req, res) => {
    updateService.assertReady();
    const proof = await reauthenticate(req);
    assertFresh(req, proof);
    // The deployment may replace this process. Acknowledgement is not installation success.
    const result = await updateService.trigger();
    loginSucceeded(ip(req));
    res.status(202).json(result);
  });

  router.post('/password', throttle, async (req, res) => {
    if (process.env.ADMIN_PASSWORD) fail(400, 'Passwort wird über ADMIN_PASSWORD gesetzt');
    const next = passwordInput(req.body?.next);
    // Hash first; reauthenticate immediately before changing anything (no await after proof).
    const hashed = await hashPassword(next);
    const proof = await reauthenticate(req);
    assertFresh(req, proof);
    tx(() => {
      setSetting('admin_password', hashed);
      rotateSession(req, res);
    });
    loginSucceeded(ip(req));
    res.json({ ok: true });
  });

  router.post('/2fa/setup', throttle, async (req, res) => {
    if (twoFactorEnabled()) fail(409, '2FA ist bereits aktiviert');
    const secret = newTotpSecret();
    const qrCode = await QRCode.toDataURL(totp(secret, adminEmail()).toString(), { width: 256, margin: 4 });
    const proof = await reauthenticate(req, false);
    assertFresh(req, proof);
    if (twoFactorEnabled()) fail(409, '2FA ist bereits aktiviert');
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ? OR (kind = 'enroll' AND session_token = ?)").run(Date.now(), sessionHash(req));
    db.prepare('INSERT INTO auth_challenges (token, kind, session_token, secret_enc, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      sha256(randomToken()), 'enroll', sessionHash(req), encrypt(secret), Date.now() + ENROLL_TTL,
    );
    loginSucceeded(ip(req));
    res.json({ secret, qrCode });
  });

  router.post('/2fa/enable', throttle, (req, res) => {
    if (twoFactorEnabled()) fail(409, '2FA ist bereits aktiviert');
    const challenge = db.prepare("SELECT * FROM auth_challenges WHERE kind = 'enroll' AND session_token = ? AND expires_at > ?").get(sessionHash(req), Date.now()) as Challenge | undefined;
    if (!challenge?.secret_enc) fail(400, 'Einrichtung abgelaufen – bitte erneut starten');
    // The encrypted pending secret only becomes active after a successful code check.
    const { secret_enc } = challenge;
    const counter = totpCounter(decrypt(secret_enc), String(req.body?.factor ?? ''));
    if (counter === null) {
      db.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE token = ?').run(challenge.token);
      if (challenge.attempts >= 4) db.prepare('DELETE FROM auth_challenges WHERE token = ?').run(challenge.token);
      loginFailed(ip(req));
      fail(400, challenge.attempts >= 4 ? 'Zu viele falsche Codes – bitte die Einrichtung neu starten' : 'Authenticator-Code ist falsch');
    }
    const codes = tx(() => {
      setSetting('admin_totp_secret', secret_enc);
      setSetting('admin_totp_counter', String(counter));
      const codes = newRecoveryCodes();
      rotateSession(req, res);
      return codes;
    });
    loginSucceeded(ip(req));
    res.json({ codes });
  });

  router.post('/2fa/cancel', (req, res) => {
    db.prepare("DELETE FROM auth_challenges WHERE kind = 'enroll' AND session_token = ?").run(sessionHash(req));
    res.json({ ok: true });
  });

  router.post('/2fa/disable', throttle, async (req, res) => {
    if (!twoFactorEnabled()) fail(400, '2FA ist nicht aktiviert');
    const proof = await reauthenticate(req);
    assertFresh(req, proof);
    tx(() => {
      db.prepare("DELETE FROM settings WHERE key IN ('admin_totp_secret', 'admin_totp_counter', 'admin_recovery_hashes')").run();
      rotateSession(req, res);
    });
    loginSucceeded(ip(req));
    res.json({ ok: true });
  });

  router.post('/2fa/recovery', throttle, async (req, res) => {
    if (!twoFactorEnabled()) fail(400, '2FA ist nicht aktiviert');
    const proof = await reauthenticate(req);
    assertFresh(req, proof);
    const codes = tx(() => {
      const codes = newRecoveryCodes();
      rotateSession(req, res);
      return codes;
    });
    loginSucceeded(ip(req));
    res.json({ codes });
  });

  return router;
}

