/**
 * Kryptografie für die Mobile-App (FlowVault Notify), ohne Zugriff auf APP_SECRET oder Datenbank:
 *
 * 1. `verifyDeviceSignature`: Prüft eine im Android-Hardware-Keystore erzeugte
 *    ECDSA-P-256-Signatur (SHA256withECDSA, SPKI-Public-Key) über eine Einmal-Challenge.
 * 2. `encryptForDevice` / `decryptWithPrivateKey`: Ende-zu-Ende-Verschlüsselung sensibler
 *    Diagnose-Ergebnisse mittels Ephemeral ECDH (P-256) + HKDF-SHA256 + AES-256-GCM.
 */
import crypto from 'node:crypto';
import type { EncryptedEnvelope } from './notify.ts';

const E2E_INFO = Buffer.from('flowvault:e2e:v1', 'utf8');

/** Prüft, ob `spkiBase64` ein gültiger EC-P-256-Public-Key im DER/SPKI-Format ist. */
export function validateEcPublicKeySpki(spkiBase64: string): string {
  const clean = spkiBase64.trim();
  if (!clean || clean.length > 512) throw new Error('Invalid public key length');
  const der = Buffer.from(clean, 'base64');
  const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec') throw new Error('Public key must be EC');
  const details = key.asymmetricKeyDetails;
  if (details?.namedCurve && details.namedCurve !== 'prime256v1' && details.namedCurve !== 'P-256') {
    throw new Error('Public key curve must be P-256');
  }
  return key.export({ format: 'der', type: 'spki' }).toString('base64');
}

/** Baut den kanonischen Text, den das Android-Gerät per Biometrie im Keystore signiert. */
export function canonicalRollbackPayload(p: {
  challengeId: string;
  nonce: string;
  deviceId: number;
  workflowId: number;
  targetVersionId: number;
}): string {
  return `flowvault:rollback:v1|${p.challengeId}|${p.nonce}|${p.deviceId}|${p.workflowId}|${p.targetVersionId}`;
}

/** Prüft eine ASN.1/DER-kodierte SHA256withECDSA-Signatur gegen einen SPKI-Public-Key. */
export function verifyDeviceSignature(spkiBase64: string, canonicalPayload: string, signatureBase64: string): boolean {
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    if (pub.asymmetricKeyType !== 'ec') return false;
    const sig = Buffer.from(signatureBase64, 'base64');
    if (!sig.length || sig.length > 256) return false;
    return crypto.verify('sha256', Buffer.from(canonicalPayload, 'utf8'), pub, sig);
  } catch {
    return false;
  }
}

/** Verschlüsselt ein Objekt Ende-zu-Ende für den öffentlichen ECDH-P-256-Schlüssel eines Mobilgeräts. */
export function encryptForDevice(payload: unknown, recipientSpkiBase64: string): EncryptedEnvelope {
  const recipientPub = crypto.createPublicKey({
    key: Buffer.from(recipientSpkiBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (recipientPub.asymmetricKeyType !== 'ec') throw new Error('Recipient key must be EC P-256');

  const ephemeral = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sharedSecret = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientPub });

  const salt = crypto.randomBytes(16);
  const aesKey = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, E2E_INFO, 32));
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv, { authTagLength: 16 });
  cipher.setAAD(E2E_INFO);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: 'ECDH-P256-HKDF-AES256GCM',
    ephemeralPublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
  };
}

/** Entschlüsselt ein `EncryptedEnvelope` mit PKCS#8-Privatschlüssel (Tests & Verifikation). */
export function decryptWithPrivateKey<T = unknown>(envelope: EncryptedEnvelope, recipientPkcs8Base64: string): T {
  const priv = crypto.createPrivateKey({
    key: Buffer.from(recipientPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const ephPub = crypto.createPublicKey({
    key: Buffer.from(envelope.ephemeralPublicKey, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const sharedSecret = crypto.diffieHellman({ privateKey: priv, publicKey: ephPub });
  const salt = Buffer.from(envelope.salt, 'base64');
  const aesKey = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, E2E_INFO, 32));
  const iv = Buffer.from(envelope.iv, 'base64');
  const combined = Buffer.from(envelope.ciphertext, 'base64');
  if (combined.length < 16) throw new Error('Ciphertext too short');
  const enc = combined.subarray(0, combined.length - 16);
  const tag = combined.subarray(combined.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv, { authTagLength: 16 });
  decipher.setAAD(E2E_INFO);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
