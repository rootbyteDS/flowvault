package de.flown8tive.flowvault.notify

import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.PairingUriParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

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
}
