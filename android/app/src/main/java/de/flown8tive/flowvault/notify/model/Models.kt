package de.flown8tive.flowvault.notify.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URI
import java.net.URLDecoder

val FlowVaultJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
}

enum class DeliveryMode(val wireValue: String) {
    UNIFIED_PUSH("unifiedpush"),
    REALTIME_SERVICE("sse_bg"),
    PERIODIC("none");

    companion object {
        fun fromWire(value: String?): DeliveryMode =
            entries.firstOrNull { it.wireValue == value } ?: PERIODIC
    }
}

@Serializable
data class QuietHoursDto(
    val enabled: Boolean = false,
    val start: String = "22:00",
    val end: String = "07:00",
    val tz: String = "Europe/Berlin",
    val allowCritical: Boolean = true,
)

@Serializable
data class DeviceDto(
    val id: Int,
    val name: String,
    val platform: String = "android",
    val hint: String = "",
    val instances: List<Int>? = null,
    val redactionMode: String = "lockscreen",
    val pushType: String = "none",
    val pushConfigured: Boolean = false,
    val language: String = "de",
    val quietHours: QuietHoursDto? = null,
    val createdAt: Long = 0,
    val lastSeenAt: Long? = null,
)

@Serializable
data class PairRequestDto(
    val code: String,
    val deviceName: String,
    val platform: String = "android",
    val language: String = "de",
)

@Serializable
data class PairedResponseDto(
    val deviceId: Int,
    val token: String,
    val serverName: String = "FlowVault",
    val serverVersion: String = "",
    val redactionMode: String = "lockscreen",
    val allowedInstances: List<Int>? = null,
)

@Serializable
data class InstanceRefDto(
    val id: Int,
    val name: String,
    val color: String = "#ea4b71",
)

@Serializable
data class WorkflowRefDto(
    val id: Int,
    val name: String,
)

@Serializable
data class VersionRefDto(
    val id: Int,
    val number: Int,
)

@Serializable
data class AiSummaryDto(
    val title: String,
    val details: List<String> = emptyList(),
)

@Serializable
data class RollbackHintDto(
    val versionId: Int,
    val number: Int,
    val rate: Double? = null,
)

@Serializable
data class FailingNodeDto(
    val name: String,
    val failed: Int = 0,
    val rate: Double = 0.0,
    val isNew: Boolean = false,
    val lastMessage: String? = null,
    val lastAt: Long? = null,
)

@Serializable
data class ChangeSummaryDto(
    val added: List<String> = emptyList(),
    val removed: List<String> = emptyList(),
    val modified: List<String> = emptyList(),
    val activeChanged: Boolean? = null,
    val nodeCount: Int = 0,
)

@Serializable
data class MessageMetadataDto(
    val summary: ChangeSummaryDto? = null,
    val aiSummary: AiSummaryDto? = null,
    val rate: Double? = null,
    val total: Int? = null,
    val failed: Int? = null,
    val baselineRate: Double? = null,
    val baselineTotal: Int? = null,
    val rollback: RollbackHintDto? = null,
    val failingNodes: List<FailingNodeDto>? = null,
    val errorNode: String? = null,
    val errorMessage: String? = null,
    val activeChanged: Boolean? = null,
    val restoredFrom: Int? = null,
    val importedCount: Int? = null,
    val webPath: String? = null,
)

@Serializable
data class MessageDto(
    val seq: Long,
    val updatedSeq: Long = seq,
    val instance: InstanceRefDto,
    val workflow: WorkflowRefDto? = null,
    val version: VersionRefDto? = null,
    val alertId: Int? = null,
    val kind: String,
    val severity: String = "normal",
    val title: String,
    val body: String,
    val groupCount: Int = 1,
    val resolvedBySeq: Long? = null,
    val metadata: MessageMetadataDto = MessageMetadataDto(),
    val createdAt: Long,
    val updatedAt: Long = createdAt,
)

@Serializable
data class MessagesResponseDto(
    val items: List<MessageDto> = emptyList(),
    val latestSeq: Long = 0,
)

@Serializable
data class RuleDto(
    val scopeType: String,
    val scopeId: Int = 0,
    val enabledKinds: List<String>? = null,
    val mutedUntil: Long? = null,
)

@Serializable
data class ChannelDto(
    val instanceId: Int,
    val name: String,
    val color: String = "#ea4b71",
    val enabled: Boolean = true,
    val lastSyncOk: Boolean? = null,
    val openAlerts: Int = 0,
    val unreadCount: Int = 0,
    val readSeq: Long = 0,
    val mutedUntil: Long? = null,
    val lastMessage: MessageDto? = null,
)

@Serializable
data class BootstrapDto(
    val serverName: String = "FlowVault",
    val serverVersion: String = "",
    val device: DeviceDto,
    val latestSeq: Long = 0,
    val openAlertsTotal: Int = 0,
    val channels: List<ChannelDto> = emptyList(),
    val rules: List<RuleDto> = emptyList(),
)

@Serializable
data class ReadRequestDto(
    val instanceId: Int,
    val readSeq: Long,
)

@Serializable
data class DeviceUpdateDto(
    val name: String? = null,
    val language: String? = null,
    val pushType: String? = null,
    val pushEndpoint: String? = null,
    val quietHours: QuietHoursDto? = null,
)

@Serializable
data class ApiErrorDto(
    val error: String? = null,
)

data class PairingTarget(
    val serverUrl: String,
    val code: String,
)

object PairingUriParser {
    /** Parst `flowvault://pair?v=1&url=https%3A%2F%2F...&code=...` sicher ohne Android-Framework-Abhängigkeit. */
    fun parse(raw: String): PairingTarget? {
        val trimmed = raw.trim()
        if (!trimmed.startsWith("flowvault://pair", ignoreCase = true)) return null
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
        val query = uri.rawQuery ?: return null
        val params = query.split("&").mapNotNull { pair ->
            val idx = pair.indexOf('=')
            if (idx <= 0) null
            else pair.substring(0, idx) to URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
        }.toMap()
        val url = params["url"]?.trim()?.trimEnd('/') ?: return null
        val code = params["code"]?.trim() ?: return null
        if (!(url.startsWith("https://") || url.startsWith("http://")) || code.isBlank()) return null
        return PairingTarget(serverUrl = url, code = code)
    }
}

object MessageCategoryHelper {
    private val changeKinds = setOf(
        "workflow_changed",
        "workflow_created",
        "workflow_deleted",
        "workflow_restored",
        "workflow_promoted",
        "initial_sync",
    )
    private val recoveryKinds = setOf(
        "alert_resolved",
        "execution_recovered",
        "sync_recovered",
        "health_poll_recovered",
    )

    fun isChange(kind: String): Boolean = kind in changeKinds
    fun isRecovery(kind: String): Boolean = kind in recoveryKinds
    fun isFail(kind: String): Boolean = !isChange(kind) && !isRecovery(kind) && kind != "test"

    fun channelIdFor(kind: String, severity: String): String = when {
        severity == "critical" || kind == "alert_opened" || kind == "alert_escalated" || kind == "sync_error" -> "fv_critical"
        isFail(kind) -> "fv_failures"
        else -> "fv_changes"
    }

    fun badgeLabel(kind: String): String = when (kind) {
        "alert_opened", "alert_escalated" -> "ALERT"
        "alert_resolved" -> "ENTWARNUNG"
        "execution_failed" -> "FAIL"
        "execution_recovered" -> "OK"
        "sync_error" -> "SYNC-FEHLER"
        "sync_recovered" -> "SYNC OK"
        "health_poll_error" -> "HEALTH"
        "health_poll_recovered" -> "HEALTH OK"
        "workflow_changed" -> "ÄNDERUNG"
        "workflow_created" -> "NEU"
        "workflow_deleted" -> "GELÖSCHT"
        "workflow_restored" -> "RESTORE"
        "workflow_promoted" -> "PROMOTE"
        "initial_sync" -> "IMPORT"
        "test" -> "TEST"
        else -> kind.uppercase()
    }
}
