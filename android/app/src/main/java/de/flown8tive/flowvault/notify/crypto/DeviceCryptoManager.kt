package de.flown8tive.flowvault.notify.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import de.flown8tive.flowvault.notify.data.SecurePrefs
import de.flown8tive.flowvault.notify.model.DiagnosisDto
import de.flown8tive.flowvault.notify.model.EncryptedEnvelopeDto
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Reine JVM-Kryptografie für Ende-zu-Ende-Verschlüsselung (ECDH-P256 + HKDF-SHA256 + AES-256-GCM)
 * und kanonische Rollback-Signaturen – direkt in Unit-Tests gegen Node.js prüfbar.
 */
object E2eCrypto {
    private val E2E_INFO = "flowvault:e2e:v1".toByteArray(StandardCharsets.UTF_8)

    data class KeyPairBase64(
        val publicSpkiBase64: String,
        val privatePkcs8Base64: String,
    )

    fun generateEcP256KeyPair(): KeyPairBase64 {
        val kpg = KeyPairGenerator.getInstance("EC")
        kpg.initialize(ECGenParameterSpec("secp256r1"))
        val kp = kpg.generateKeyPair()
        val enc = Base64.getEncoder()
        return KeyPairBase64(
            publicSpkiBase64 = enc.encodeToString(kp.public.encoded),
            privatePkcs8Base64 = enc.encodeToString(kp.private.encoded),
        )
    }

    fun canonicalRollbackPayload(
        challengeId: String,
        nonce: String,
        deviceId: Int,
        workflowId: Int,
        targetVersionId: Int,
    ): String = "flowvault:rollback:v1|$challengeId|$nonce|$deviceId|$workflowId|$targetVersionId"

    /** RFC 5869 HKDF-SHA256 für 32 Byte Ausgabeschlüssel. */
    fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int = 32): ByteArray {
        require(length in 1..32) { "Single-block HKDF supports up to 32 bytes" }
        val actualSalt = if (salt.isEmpty()) ByteArray(32) else salt
        val macExtract = Mac.getInstance("HmacSHA256")
        macExtract.init(SecretKeySpec(actualSalt, "HmacSHA256"))
        val prk = macExtract.doFinal(ikm)

        val macExpand = Mac.getInstance("HmacSHA256")
        macExpand.init(SecretKeySpec(prk, "HmacSHA256"))
        macExpand.update(info)
        macExpand.update(0x01.toByte())
        return macExpand.doFinal().copyOf(length)
    }

    fun decryptEnvelopeToUtf8(envelope: EncryptedEnvelopeDto, privatePkcs8Base64: String): String {
        require(envelope.alg == "ECDH-P256-HKDF-AES256GCM") { "Unsupported E2E algorithm: ${envelope.alg}" }
        val dec = Base64.getDecoder()
        val kf = KeyFactory.getInstance("EC")
        val privKey = kf.generatePrivate(PKCS8EncodedKeySpec(dec.decode(privatePkcs8Base64)))
        val ephPubKey = kf.generatePublic(X509EncodedKeySpec(dec.decode(envelope.ephemeralPublicKey)))

        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(privKey)
        ka.doPhase(ephPubKey, true)
        val sharedSecret = ka.generateSecret()

        val salt = dec.decode(envelope.salt)
        val iv = dec.decode(envelope.iv)
        val ciphertextWithTag = dec.decode(envelope.ciphertext)

        val aesKey = hkdfSha256(sharedSecret, salt, E2E_INFO, 32)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(E2E_INFO)
        val plain = cipher.doFinal(ciphertextWithTag)
        return String(plain, StandardCharsets.UTF_8)
    }
}

/**
 * Verwaltet die beiden Geräteschlüssel auf Android:
 * 1. Hardware-gebundener ECDSA-P-256-Signaturschlüssel im `AndroidKeyStore` (nicht exportierbar) für Rollbacks.
 * 2. ECDH-P-256-Schlüsselpaar (in Keystore-verschlüsselten `SecurePrefs`) für Ende-zu-Ende-verschlüsselte Diagnosen.
 */
class DeviceCryptoManager(private val prefs: SecurePrefs) {
    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val SIGNING_KEY_ALIAS = "fv_rollback_sign_v1"
    }

    data class PublicKeys(
        val signingPublicKeySpki: String,
        val encryptionPublicKeySpki: String,
    )

    @Synchronized
    fun ensureKeys(): PublicKeys {
        val signPub = ensureHardwareSigningKey()
        var encPub = prefs.e2ePublicKey
        var encPriv = prefs.e2ePrivateKey
        if (encPub.isNullOrBlank() || encPriv.isNullOrBlank()) {
            val pair = E2eCrypto.generateEcP256KeyPair()
            encPub = pair.publicSpkiBase64
            encPriv = pair.privatePkcs8Base64
            prefs.e2ePublicKey = encPub
            prefs.e2ePrivateKey = encPriv
        }
        return PublicKeys(signingPublicKeySpki = signPub, encryptionPublicKeySpki = encPub)
    }

    private fun ensureHardwareSigningKey(): String {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = ks.getCertificate(SIGNING_KEY_ALIAS)?.publicKey
        if (existing != null) {
            return Base64.getEncoder().encodeToString(existing.encoded)
        }
        val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            SIGNING_KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build()
        kpg.initialize(spec)
        val kp = kpg.generateKeyPair()
        return Base64.getEncoder().encodeToString(kp.public.encoded)
    }

    /** Signiert den kanonischen Rollback-Challenge-String im Android-Hardware-Keystore (nach Biometrie-Prüfung). */
    fun signRollbackChallenge(
        challengeId: String,
        nonce: String,
        deviceId: Int,
        workflowId: Int,
        targetVersionId: Int,
    ): String {
        ensureHardwareSigningKey()
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val entry = ks.getEntry(SIGNING_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            ?: error("Hardware-Signaturschlüssel im Android Keystore nicht verfügbar")
        val canonical = E2eCrypto.canonicalRollbackPayload(challengeId, nonce, deviceId, workflowId, targetVersionId)
        val sig = Signature.getInstance("SHA256withECDSA")
        sig.initSign(entry.privateKey)
        sig.update(canonical.toByteArray(StandardCharsets.UTF_8))
        return Base64.getEncoder().encodeToString(sig.sign())
    }

    fun decryptDiagnosis(envelope: EncryptedEnvelopeDto): DiagnosisDto {
        val priv = prefs.e2ePrivateKey ?: error("Kein privater E2E-Schlüssel vorhanden")
        val json = E2eCrypto.decryptEnvelopeToUtf8(envelope, priv)
        return FlowVaultJson.decodeFromString<DiagnosisDto>(json)
    }

    fun clearHardwareKeys() {
        runCatching {
            val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (ks.containsAlias(SIGNING_KEY_ALIAS)) ks.deleteEntry(SIGNING_KEY_ALIAS)
        }
    }
}
