package de.flown8tive.flowvault.notify.data

import android.content.Context
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.model.DeviceUpdateDto
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.QuietHoursDto
import de.flown8tive.flowvault.notify.model.RuleDto
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ConnectionState {
    OFFLINE,
    CONNECTING,
    LIVE,
    SYNCED,
}

class NotifyRepository(
    private val context: Context,
    val prefs: SecurePrefs,
    private val db: FlowVaultDatabase,
    val api: FlowVaultApi,
    private val notifications: NotificationHelper,
) {
    private val dao = db.dao()

    private val _connectionState = MutableStateFlow(ConnectionState.OFFLINE)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    val channelsFlow: Flow<List<ChannelEntity>> = dao.observeChannels()
    val openAlertMessagesFlow: Flow<List<MessageEntity>> = dao.observeOpenAlertMessages()

    fun messagesForInstance(instanceId: Int): Flow<List<MessageEntity>> = dao.observeMessagesForInstance(instanceId)
    fun searchMessages(query: String): Flow<List<MessageEntity>> = dao.searchMessages("%$query%")

    fun setConnectionState(state: ConnectionState) {
        _connectionState.value = state
    }

    suspend fun pair(serverUrl: String, code: String, deviceName: String) {
        val cleanUrl = serverUrl.trim().trimEnd('/')
        val res = api.pair(cleanUrl, code.trim(), deviceName.trim().ifEmpty { prefs.deviceName })
        prefs.serverUrl = cleanUrl
        prefs.deviceToken = res.token
        prefs.deviceId = res.deviceId
        prefs.deviceName = deviceName.trim().ifEmpty { prefs.deviceName }
        prefs.serverVersion = res.serverVersion
        prefs.redactionMode = res.redactionMode
        syncFull(notifyNew = false)
    }

    /** Vollständiger Abgleich (Bootstrap + neue Nachrichten seit `latestSeq`). */
    suspend fun syncFull(notifyNew: Boolean = true): List<MessageDto> {
        val url = prefs.serverUrl ?: return emptyList()
        val token = prefs.deviceToken ?: return emptyList()
        val boot = api.bootstrap(url, token)
        prefs.serverVersion = boot.serverVersion
        prefs.redactionMode = boot.device.redactionMode
        boot.device.quietHours?.let { prefs.quietHours = it }
        prefs.lastSyncAt = System.currentTimeMillis()

        val channelEntities = boot.channels.map { it.toEntity() }
        if (channelEntities.isNotEmpty()) {
            dao.upsertChannels(channelEntities)
            dao.pruneChannels(channelEntities.map { it.instanceId })
        } else {
            dao.clearChannels()
        }

        val lastKnown = prefs.latestSeq
        val response = if (lastKnown == 0L) {
            api.fetchMessages(url, token, limit = 100)
        } else {
            api.fetchMessages(url, token, after = lastKnown, limit = 200)
        }

        val newlyCreated = mutableListOf<MessageDto>()
        if (response.items.isNotEmpty()) {
            val entities = response.items.map { it.toEntity() }
            dao.upsertMessages(entities)
            for (msg in response.items) {
                if (msg.kind == "alert_resolved" && msg.alertId != null) {
                    dao.markAlertResolved(msg.alertId, msg.seq)
                }
                if (notifyNew && lastKnown > 0L && msg.seq > lastKnown) {
                    newlyCreated += msg
                }
            }
        }
        val nextSeq = maxOf(prefs.latestSeq, boot.latestSeq, response.latestSeq)
        prefs.latestSeq = nextSeq

        if (notifyNew && newlyCreated.isNotEmpty()) {
            for (msg in newlyCreated) {
                val ch = dao.getChannel(msg.instance.id)
                if (!isMuted(ch?.mutedUntil)) {
                    notifications.showMessage(msg, dao.recentForInstance(msg.instance.id).map { it.toDto() })
                }
            }
        }
        if (_connectionState.value != ConnectionState.LIVE) {
            _connectionState.value = ConnectionState.SYNCED
        }
        return newlyCreated
    }

    /** Verarbeitet ein eingehendes SSE-Event in Echtzeit. */
    suspend fun handleStreamMessage(msg: MessageDto, isNew: Boolean, activeInstanceId: Int? = null) {
        dao.upsertMessages(listOf(msg.toEntity()))
        if (msg.kind == "alert_resolved" && msg.alertId != null) {
            dao.markAlertResolved(msg.alertId, msg.seq)
        }
        if (msg.updatedSeq > prefs.latestSeq) prefs.latestSeq = msg.updatedSeq
        prefs.lastSyncAt = System.currentTimeMillis()

        // Kanal-Vorschau sofort aktualisieren
        val existing = dao.getChannel(msg.instance.id)
        val unreadInc = if (isNew && activeInstanceId != msg.instance.id) 1 else 0
        val updatedChannel = (existing ?: ChannelEntity(
            instanceId = msg.instance.id,
            name = msg.instance.name,
            color = msg.instance.color,
            enabled = true,
            lastSyncOk = true,
            openAlerts = 0,
            unreadCount = 0,
            readSeq = 0,
            mutedUntil = null,
            lastMessageTitle = null,
            lastMessageBody = null,
            lastMessageKind = null,
            lastMessageAt = null,
        )).copy(
            name = msg.instance.name,
            color = msg.instance.color,
            unreadCount = (existing?.unreadCount ?: 0) + unreadInc,
            lastMessageTitle = msg.title,
            lastMessageBody = msg.body,
            lastMessageKind = msg.kind,
            lastMessageAt = msg.updatedAt,
        )
        dao.upsertChannels(listOf(updatedChannel))

        if (isNew && activeInstanceId != msg.instance.id && !isMuted(existing?.mutedUntil)) {
            notifications.showMessage(msg, dao.recentForInstance(msg.instance.id).map { it.toDto() })
        }
    }

    suspend fun loadInstanceHistory(instanceId: Int) {
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        val res = api.fetchMessages(url, token, instanceId = instanceId, limit = 100)
        if (res.items.isNotEmpty()) {
            dao.upsertMessages(res.items.map { it.toEntity() })
        }
    }

    suspend fun markChannelRead(instanceId: Int, readSeq: Long? = null) {
        val seq = readSeq ?: prefs.latestSeq
        dao.markChannelRead(instanceId, seq)
        notifications.cancelInstanceNotifications(instanceId)
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        runCatching { api.markRead(url, token, instanceId, seq) }
    }

    suspend fun muteInstance(instanceId: Int, durationMs: Long?) {
        val until = when (durationMs) {
            null -> null
            -1L -> -1L
            else -> System.currentTimeMillis() + durationMs
        }
        dao.updateChannelMute(instanceId, until)
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        api.upsertRule(url, token, RuleDto(scopeType = "instance", scopeId = instanceId, mutedUntil = until))
    }

    suspend fun muteWorkflow(workflowId: Int, durationMs: Long?) {
        val until = when (durationMs) {
            null -> null
            -1L -> -1L
            else -> System.currentTimeMillis() + durationMs
        }
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        api.upsertRule(url, token, RuleDto(scopeType = "workflow", scopeId = workflowId, mutedUntil = until))
    }

    suspend fun dismissAlert(alertId: Int) {
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        api.dismissAlert(url, token, alertId)
        dao.markAlertResolved(alertId, -1L)
        syncFull(notifyNew = false)
    }

    suspend fun updateDelivery(mode: DeliveryMode, pushEndpoint: String? = prefs.unifiedPushEndpoint) {
        prefs.deliveryMode = mode
        if (mode == DeliveryMode.UNIFIED_PUSH) prefs.unifiedPushEndpoint = pushEndpoint
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        api.updateDevice(
            url,
            token,
            DeviceUpdateDto(
                pushType = mode.wireValue,
                pushEndpoint = if (mode == DeliveryMode.UNIFIED_PUSH) pushEndpoint else null,
            ),
        )
    }

    suspend fun updateQuietHours(qh: QuietHoursDto) {
        prefs.quietHours = qh
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        api.updateDevice(url, token, DeviceUpdateDto(quietHours = qh))
    }

    suspend fun unpair() {
        val url = prefs.serverUrl
        val token = prefs.deviceToken
        if (!url.isNullOrBlank() && !token.isNullOrBlank()) {
            runCatching { api.unpair(url, token) }
        }
        dao.clearMessages()
        dao.clearChannels()
        prefs.clearAll()
        _connectionState.value = ConnectionState.OFFLINE
    }

    private fun isMuted(mutedUntil: Long?): Boolean {
        if (mutedUntil == null) return false
        return mutedUntil == -1L || mutedUntil > System.currentTimeMillis()
    }
}
