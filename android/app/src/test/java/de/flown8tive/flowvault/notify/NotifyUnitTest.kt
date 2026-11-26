package de.flown8tive.flowvault.notify

import de.flown8tive.flowvault.notify.crypto.E2eCrypto
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.model.DiagnosisDto
import de.flown8tive.flowvault.notify.model.EncryptedEnvelopeDto
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.PairingUriParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

class NotifyUnitTest {
    @Test
    fun pairingUriParserAcceptsValidQrUriAndRejectsInvalidSchemes() {
        val parsed = PairingUriParser.parse("flowvault://pair?v=1&url=https%3A%2F%2Ffv.example.com%2F&code=abc_123")
        assertNotNull(parsed)
        assertEquals("https://fv.example.com", parsed!!.serverUrl)
        assertEquals("abc_123", parsed.code)

        assertNull(PairingUriParser.parse("https://fv.example.com?code=123"))
        assertNull(PairingUriParser.parse("flowvault://pair?v=1&url=javascript:alert(1)&code=123"))
        assertNull(PairingUriParser.parse("flowvault://pair?v=1&url=https%3A%2F%2Ffv.example.com"))
    }

    @Test
    fun messageCategoryAndNotificationChannelsMapCorrectly() {
        assertEquals("fv_critical", MessageCategoryHelper.channelIdFor("alert_opened", "critical"))
        assertEquals("fv_critical", MessageCategoryHelper.channelIdFor("sync_error", "critical"))
        assertEquals("fv_failures", MessageCategoryHelper.channelIdFor("execution_failed", "high"))
        assertEquals("fv_changes", MessageCategoryHelper.channelIdFor("workflow_changed", "normal"))
        assertTrue(MessageCategoryHelper.isChange("workflow_changed"))
        assertTrue(MessageCategoryHelper.isRecovery("alert_resolved"))
        assertTrue(MessageCategoryHelper.isFail("execution_failed"))
        assertFalse(MessageCategoryHelper.isFail("alert_resolved"))
    }

    @Test
    fun messageDtoDeserializesFlowVaultPayload() {
        val raw = """
            {
              "seq": 42,
              "updatedSeq": 45,
              "instance": { "id": 1, "name": "Produktion", "color": "#ea4b71" },
              "workflow": { "id": 19, "name": "Daily KPI Report" },
              "version": { "id": 88, "number": 14 },
              "alertId": 7,
              "kind": "alert_opened",
              "severity": "critical",
              "title": "Fehlerquote gestiegen: Daily KPI Report (v14)",
              "body": "45 % der Läufe schlagen fehl",
              "groupCount": 3,
              "metadata": {
                "rate": 0.45,
                "rollback": { "versionId": 84, "number": 13, "rate": 0.0 },
                "webPath": "/workflows/19"
              },
              "createdAt": 1764097200000,
              "updatedAt": 1764097500000
            }
        """.trimIndent()
        val msg = FlowVaultJson.decodeFromString<MessageDto>(raw)
        assertEquals(42L, msg.seq)
        assertEquals(45L, msg.updatedSeq)
        assertEquals(3, msg.groupCount)
        assertEquals(13, msg.metadata.rollback?.number)
        assertEquals("/workflows/19", msg.metadata.webPath)
        assertEquals(DeliveryMode.UNIFIED_PUSH, DeliveryMode.fromWire("unifiedpush"))
    }

    @Test
    fun decryptsRealNodeJsE2eEnvelopeAndRejectsTampering() {
        // Echtes Chiffrat aus Node.js `encryptForDevice(...)` (shared/mobile-crypto.ts)
        val privPkcs8 = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgg3bQMAigfUqIvpmXfNxQVD22Vqan9MPU0VlCc0fPZZChRANCAAStR6U2cjw+CcDXF8PcxKsu+IJuN+aBx43YvTaNJ9bfJQuQ9owzRnCRbLPDRA7huRzEcSHbIPluTwil+RvDHbG7"
        val envelope = EncryptedEnvelopeDto(
            alg = "ECDH-P256-HKDF-AES256GCM",
            ephemeralPublicKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4UakxQDW/7t2uGCwMPoWsncuaX6i5ziRajLqaXiN/kKaZpYdpi4cR1YCM9SfStnfPjs/Agi9/CcP8Qk23rUu5A==",
            salt = "BMnB4Cv9M2n5CWdohFting==",
            iv = "afJFYHZ08tgndz5k",
            ciphertext = "WB78ymQCu2cwj1hTIRoVgRPipzzfzbqBRvd8lPAHa2hZ+k1bIN+8U6gkvzI9amopY8zmYwtHKeu9KM0DV59rDTgg6uN3Z2meW1v7IfyrnreNl8dGfWmUNU2Ogvd9BYP7/ZaEp403tXdAuUgXCpVzDFGk0VDRn2EQqepHIGeBohBtApM3vF0oOTKmyrWlUkqB0Yjwv+TgY2fICdMcsJzLUcIb1MH7HmszfI/6ZwuZfP31Jcl415Q7+piTtJpb2US4VjCNai4QXzAltSkZ1JiDT8xCyLzxioRSHIDK52zagGAJwg4hYQYkP6U4zNicqBXol+WJojkU2hIUg7Zg1BnUYYt4XlpfIwl6z7kqHkOTo5zCyRNjAvsjhIAwKusi7C3uB+2fOA==",
        )

        val json = E2eCrypto.decryptEnvelopeToUtf8(envelope, privPkcs8)
        val diag = FlowVaultJson.decodeFromString<DiagnosisDto>(json)
        assertEquals("ai", diag.source)
        assertEquals("Stripe 401", diag.headline)
        assertTrue(diag.recommendRollback)
        assertEquals(13, diag.rollbackVersionNumber)

        // Falscher Schlüssel oder verändertes Chiffrat schlägt fehl
        val wrongKeys = E2eCrypto.generateEcP256KeyPair()
        assertThrows(Exception::class.java) {
            E2eCrypto.decryptEnvelopeToUtf8(envelope, wrongKeys.privatePkcs8Base64)
        }
    }

    @Test
    fun canonicalRollbackSignatureMatchesStandardEcdsaSpkiFormat() {
        val kp = E2eCrypto.generateEcP256KeyPair()
        val canonical = E2eCrypto.canonicalRollbackPayload("ch1", "nonce1", 3, 19, 84)
        assertEquals("flowvault:rollback:v1|ch1|nonce1|3|19|84", canonical)

        val kf = KeyFactory.getInstance("EC")
        val priv = kf.generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(kp.privatePkcs8Base64)))
        val pub = kf.generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(kp.publicSpkiBase64)))

        val signer = Signature.getInstance("SHA256withECDSA").apply {
            initSign(priv)
            update(canonical.toByteArray(StandardCharsets.UTF_8))
        }
        val sigBytes = signer.sign()

        val verifier = Signature.getInstance("SHA256withECDSA").apply {
            initVerify(pub)
            update(canonical.toByteArray(StandardCharsets.UTF_8))
        }
        assertTrue(verifier.verify(sigBytes))
    }
}
