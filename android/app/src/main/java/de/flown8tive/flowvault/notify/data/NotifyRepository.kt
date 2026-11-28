package de.flown8tive.flowvault.notify.data

import android.content.Context
import de.flown8tive.flowvault.notify.crypto.DeviceCryptoManager
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.model.DeviceUpdateDto
import de.flown8tive.flowvault.notify.model.DiagnosisDto
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.QuietHoursDto
import de.flown8tive.flowvault.notify.model.RollbackChallengeDto
import de.flown8tive.flowvault.notify.model.RollbackExecuteResponseDto
import de.flown8tive.flowvault.notify.model.RuleDto
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import de.flown8tive.flowvault.notify.service.RealtimeSyncService
import de.flown8tive.flowvault.notify.widget.FlowVaultWidgetUpdater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString

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
    val crypto: DeviceCryptoManager,
) {
    private val dao = db.dao()

    private val _connectionState = MutableStateFlow(ConnectionState.OFFLINE)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _lastHeartbeatAt = MutableStateFlow(prefs.lastHeartbeatAt)
    val lastHeartbeatFlow: StateFlow<Long> = _lastHeartbeatAt.asStateFlow()

    private val _allowRollback = MutableStateFlow(prefs.allowRollback)
    val allowRollbackFlow: StateFlow<Boolean> = _allowRollback.asStateFlow()

    @Volatile
    var activeInstanceId: Int? = null

    val channelsFlow: Flow<List<ChannelEntity>> = dao.observeChannels()
    val openAlertMessagesFlow: Flow<List<MessageEntity>> = dao.observeOpenAlertMessages()
    val unreadMessagesFlow: Flow<List<MessageEntity>> = dao.observeAllUnreadMessages()

    fun messagesForInstance(instanceId: Int): Flow<List<MessageEntity>> = dao.observeMessagesForInstance(instanceId)
    fun searchMessages(query: String): Flow<List<MessageEntity>> = dao.searchMessages("%$query%")

    fun setConnectionState(state: ConnectionState) {
        val changed = _connectionState.value != state
        _connectionState.value = state
        if (changed) FlowVaultWidgetUpdater.updateAllAsync(context)
    }

    fun recordHeartbeat() {
        val now = System.currentTimeMillis()
        prefs.lastHeartbeatAt = now
        _lastHeartbeatAt.value = now
    }

    suspend fun pair(serverUrl: String, code: String, deviceName: String) {
        val cleanUrl = serverUrl.trim().trimEnd('/')
        val keys = withContext(Dispatchers.IO) { crypto.ensureKeys() }
        val res = api.pair(
            serverUrl = cleanUrl,
            code = code.trim(),
            deviceName = deviceName.trim().ifEmpty { prefs.deviceName },
            signingPublicKey = keys.signingPublicKeySpki,
            encryptionPublicKey = keys.encryptionPublicKeySpki,
        )
        prefs.serverUrl = cleanUrl
        prefs.deviceToken = res.token
        prefs.deviceId = res.deviceId
        prefs.deviceName = deviceName.trim().ifEmpty { prefs.deviceName }
        prefs.serverVersion = res.serverVersion
        prefs.redactionMode = res.redactionMode
        prefs.allowRollback = res.allowRollback
        _allowRollback.value = res.allowRollback
        // Standardmäßig sofort den zuverlässigen Echtzeit-Dienst aktivieren
        prefs.deliveryMode = DeliveryMode.REALTIME_SERVICE
        runCatching { api.updateDevice(cleanUrl, res.token, DeviceUpdateDto(pushType = DeliveryMode.REALTIME_SERVICE.wireValue)) }
        syncFull(notifyNew = false)
        RealtimeSyncService.start(context)
    }

    /** Vollständiger Abgleich (Bootstrap + Schlüssel-Sync + neue Nachrichten). */
    suspend fun syncFull(notifyNew: Boolean = true): List<MessageDto> {
        val url = prefs.serverUrl ?: return emptyList()
        val token = prefs.deviceToken ?: return emptyList()
        val boot = api.bootstrap(url, token)
        prefs.serverVersion = boot.serverVersion
        prefs.redactionMode = boot.device.redactionMode
        prefs.allowRollback = boot.device.allowRollback
        _allowRollback.value = boot.device.allowRollback
        boot.device.quietHours?.let { prefs.quietHours = it }
        prefs.lastSyncAt = System.currentTimeMillis()

        if (!boot.device.signingKeyConfigured || !boot.device.encryptionKeyConfigured) {
            runCatching {
                val keys = withContext(Dispatchers.IO) { crypto.ensureKeys() }
                api.updateDevice(
                    url,
                    token,
                    DeviceUpdateDto(
                        signingPublicKey = keys.signingPublicKeySpki,
                        encryptionPublicKey = keys.encryptionPublicKeySpki,
                    ),
                )
            }
        }

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
            val entities = response.items.map { dto ->
                val prior = dao.getMessage(dto.seq)
                dto.toEntity(defaultUnread = dto.unread ?: (lastKnown > 0L && dto.seq > lastKnown))
                    .copy(diagnosisJson = prior?.diagnosisJson)
            }
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
                if (activeInstanceId != msg.instance.id && !isMuted(ch?.mutedUntil)) {
                    notifications.showMessage(msg, dao.recentForInstance(msg.instance.id).map { it.toDto() })
                }
            }
        }
        if (_connectionState.value != ConnectionState.LIVE) {
            _connectionState.value = ConnectionState.SYNCED
        }
        FlowVaultWidgetUpdater.updateAllAsync(context)
        return newlyCreated
    }

    /** Verarbeitet ein eingehendes SSE-Event in Echtzeit. */
    suspend fun handleStreamMessage(msg: MessageDto, isNew: Boolean, overrideActiveInstance: Int? = null) {
        val currentOpen = overrideActiveInstance ?: activeInstanceId
        val prior = dao.getMessage(msg.seq)
        val shouldMarkUnread = if (isNew) currentOpen != msg.instance.id else (prior?.unread ?: false)
        dao.upsertMessages(listOf(msg.toEntity(defaultUnread = shouldMarkUnread).copy(unread = shouldMarkUnread, diagnosisJson = prior?.diagnosisJson)))
        if (msg.kind == "alert_resolved" && msg.alertId != null) {
            dao.markAlertResolved(msg.alertId, msg.seq)
        }
        if (msg.updatedSeq > prefs.latestSeq) prefs.latestSeq = msg.updatedSeq
        prefs.lastSyncAt = System.currentTimeMillis()
        recordHeartbeat()

        val existing = dao.getChannel(msg.instance.id)
        val unreadInc = if (isNew && shouldMarkUnread) 1 else 0
        val alertDelta = when {
            isNew && (msg.kind == "alert_opened" || msg.kind == "alert_escalated") -> 1
            isNew && msg.kind == "alert_resolved" -> -1
            else -> 0
        }
        val updatedChannel = (existing ?: ChannelEntity(
            instanceId = msg.instance.id,
            name = msg.instance.name,
            color = msg.instance.color,
            instanceUrl = msg.metadata.instanceUrl,
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
            instanceUrl = msg.metadata.instanceUrl ?: existing?.instanceUrl,
            openAlerts = ((existing?.openAlerts ?: 0) + alertDelta).coerceAtLeast(0),
            unreadCount = (existing?.unreadCount ?: 0) + unreadInc,
            lastMessageTitle = msg.title,
            lastMessageBody = msg.body,
            lastMessageKind = msg.kind,
            lastMessageAt = msg.updatedAt,
        )
        dao.upsertChannels(listOf(updatedChannel))
        FlowVaultWidgetUpdater.updateAllAsync(context)

        // System-Benachrichtigung bei neuen Meldungen außerhalb des aktuell geöffneten Chats – und immer bei Selbsttests!
        if ((isNew && currentOpen != msg.instance.id && !isMuted(existing?.mutedUntil)) || msg.kind == "test") {
            notifications.showMessage(msg, dao.recentForInstance(msg.instance.id).map { it.toDto() })
        }
    }

    suspend fun loadInstanceHistory(instanceId: Int) {
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        val res = api.fetchMessages(url, token, instanceId = instanceId, limit = 100)
        if (res.items.isNotEmpty()) {
            val entities = res.items.map { dto ->
                val prior = dao.getMessage(dto.seq)
                dto.toEntity(defaultUnread = dto.unread ?: prior?.unread ?: false)
                    .copy(diagnosisJson = prior?.diagnosisJson)
            }
            dao.upsertMessages(entities)
        }
    }

    suspend fun analyzeMessage(seq: Long): DiagnosisDto {
        val url = prefs.serverUrl ?: error("Nicht verbunden")
        val token = prefs.deviceToken ?: error("Nicht verbunden")
        val res = api.analyzeMessage(url, token, seq)
        val diag = when {
            res.encrypted && res.envelope != null -> withContext(Dispatchers.Default) {
                crypto.decryptDiagnosis(res.envelope)
            }
            res.diagnosis != null -> res.diagnosis
            else -> error("Leere Diagnose-Antwort")
        }
        dao.saveDiagnosis(seq, FlowVaultJson.encodeToString(diag))
        return diag
    }

    suspend fun requestRollbackChallenge(workflowId: Int, targetVersionId: Int): RollbackChallengeDto {
        val url = prefs.serverUrl ?: error("Nicht verbunden")
        val token = prefs.deviceToken ?: error("Nicht verbunden")
        return api.requestRollbackChallenge(url, token, workflowId, targetVersionId)
    }

    suspend fun executeSignedRollback(challenge: RollbackChallengeDto): RollbackExecuteResponseDto {
        val url = prefs.serverUrl ?: error("Nicht verbunden")
        val token = prefs.deviceToken ?: error("Nicht verbunden")
        val signature = withContext(Dispatchers.IO) {
            crypto.signRollbackChallenge(
                challengeId = challenge.challengeId,
                nonce = challenge.nonce,
                deviceId = prefs.deviceId,
                workflowId = challenge.workflowId,
                targetVersionId = challenge.targetVersionId,
            )
        }
        val out = api.executeRollback(url, token, challenge.challengeId, signature)
        syncFull(notifyNew = false)
        return out
    }

    /** Ganzen Kanal als gelesen markieren. */
    suspend fun markChannelRead(instanceId: Int, readSeq: Long? = null) {
        val seq = readSeq ?: maxOf(prefs.latestSeq, dao.latestSeqInChannel(instanceId) ?: 0L)
        dao.markMessagesReadUpTo(instanceId, seq)
        dao.markChannelReadRow(instanceId, seq)
        notifications.cancelInstanceNotifications(instanceId)
        FlowVaultWidgetUpdater.updateAllAsync(context)
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        runCatching { api.markRead(url, token, instanceId, seq) }
    }

    /** Alle Kanäle und Meldungen auf einmal als gelesen markieren (z. B. aus Fokus oder Widget). */
    suspend fun markAllRead() {
        val channels = dao.getAllChannelsSnapshot()
        dao.markAllMessagesRead()
        dao.clearAllChannelUnreadCounts()
        for (ch in channels) {
            notifications.cancelInstanceNotifications(ch.instanceId)
        }
        FlowVaultWidgetUpdater.updateAllAsync(context)
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        for (ch in channels.filter { it.unreadCount > 0 }) {
            val seq = maxOf(prefs.latestSeq, dao.latestSeqInChannel(ch.instanceId) ?: 0L)
            runCatching { api.markRead(url, token, ch.instanceId, seq) }
        }
    }

    /** Ganzen Kanal gezielt wieder als ungelesen markieren (z. B. zur späteren Bearbeitung). */
    suspend fun markChannelUnread(instanceId: Int) {
        val latest = dao.latestSeqInChannel(instanceId)
        if (latest != null) {
            dao.setMessageUnreadFlag(latest, true)
            val count = dao.countUnreadInChannel(instanceId).coerceAtLeast(1)
            dao.setChannelUnreadCount(instanceId, count)
        } else {
            dao.setChannelUnreadCount(instanceId, 1)
        }
        FlowVaultWidgetUpdater.updateAllAsync(context)
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        runCatching { api.markChannelUnread(url, token, instanceId) }
    }

    /** Einzelne Nachricht als gelesen oder ungelesen markieren. */
    suspend fun setMessageUnread(seq: Long, instanceId: Int, unread: Boolean) {
        dao.setMessageUnreadFlag(seq, unread)
        val count = dao.countUnreadInChannel(instanceId)
        dao.setChannelUnreadCount(instanceId, count)
        if (!unread && count == 0) notifications.cancelInstanceNotifications(instanceId)
        FlowVaultWidgetUpdater.updateAllAsync(context)
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        runCatching { api.setMessageUnread(url, token, seq, unread) }
    }

    suspend fun sendSelfTest() {
        val url = prefs.serverUrl ?: error("Nicht verbunden")
        val token = prefs.deviceToken ?: error("Nicht verbunden")
        api.triggerSelfTest(url, token)
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
        crypto.clearHardwareKeys()
        dao.clearMessages()
        dao.clearChannels()
        prefs.clearAll()
        _allowRollback.value = false
        _connectionState.value = ConnectionState.OFFLINE
        FlowVaultWidgetUpdater.updateAllAsync(context)
    }

    private fun isMuted(mutedUntil: Long?): Boolean {
        if (mutedUntil == null) return false
        return mutedUntil == -1L || mutedUntil > System.currentTimeMillis()
    }
}
