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

    private val _allowRollback = MutableStateFlow(prefs.allowRollback)
    val allowRollbackFlow: StateFlow<Boolean> = _allowRollback.asStateFlow()

    val channelsFlow: Flow<List<ChannelEntity>> = dao.observeChannels()
    val openAlertMessagesFlow: Flow<List<MessageEntity>> = dao.observeOpenAlertMessages()

    fun messagesForInstance(instanceId: Int): Flow<List<MessageEntity>> = dao.observeMessagesForInstance(instanceId)
    fun searchMessages(query: String): Flow<List<MessageEntity>> = dao.searchMessages("%$query%")

    fun setConnectionState(state: ConnectionState) {
        _connectionState.value = state
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
        syncFull(notifyNew = false)
    }

    /** Vollständiger Abgleich (Bootstrap + ggf. automatische Schlüssel-Registrierung + neue Nachrichten). */
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

        // Falls dieses Gerät noch vor dem Update gekoppelt wurde: Hardware- & E2E-Public-Keys automatisch nachreichen
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
                val priorDiag = dao.getMessage(dto.seq)?.diagnosisJson
                dto.toEntity().copy(diagnosisJson = priorDiag)
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

    /** Verarbeitet ein eingehendes SSE-Event in Echtzeit (erhält bereits entschlüsselte lokale Diagnosen). */
    suspend fun handleStreamMessage(msg: MessageDto, isNew: Boolean, activeInstanceId: Int? = null) {
        val priorDiag = dao.getMessage(msg.seq)?.diagnosisJson
        dao.upsertMessages(listOf(msg.toEntity().copy(diagnosisJson = priorDiag)))
        if (msg.kind == "alert_resolved" && msg.alertId != null) {
            dao.markAlertResolved(msg.alertId, msg.seq)
        }
        if (msg.updatedSeq > prefs.latestSeq) prefs.latestSeq = msg.updatedSeq
        prefs.lastSyncAt = System.currentTimeMillis()

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
            val entities = res.items.map { dto ->
                val priorDiag = dao.getMessage(dto.seq)?.diagnosisJson
                dto.toEntity().copy(diagnosisJson = priorDiag)
            }
            dao.upsertMessages(entities)
        }
    }

    /** Fordert eine Ende-zu-Ende-verschlüsselte Fehleranalyse an, entschlüsselt sie lokal und speichert sie in Room. */
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

    /** Schritt 1: 60s Einmal-Challenge für ein Rollback vom Server holen. */
    suspend fun requestRollbackChallenge(workflowId: Int, targetVersionId: Int): RollbackChallengeDto {
        val url = prefs.serverUrl ?: error("Nicht verbunden")
        val token = prefs.deviceToken ?: error("Nicht verbunden")
        return api.requestRollbackChallenge(url, token, workflowId, targetVersionId)
    }

    /** Schritt 2: Im Android-Keystore signierte Challenge absenden und Stand synchronisieren. */
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
        crypto.clearHardwareKeys()
        dao.clearMessages()
        dao.clearChannels()
        prefs.clearAll()
        _allowRollback.value = false
        _connectionState.value = ConnectionState.OFFLINE
    }

    private fun isMuted(mutedUntil: Long?): Boolean {
        if (mutedUntil == null) return false
        return mutedUntil == -1L || mutedUntil > System.currentTimeMillis()
    }
}
