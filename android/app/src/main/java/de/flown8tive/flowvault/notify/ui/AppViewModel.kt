package de.flown8tive.flowvault.notify.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import de.flown8tive.flowvault.notify.FlowVaultApp
import de.flown8tive.flowvault.notify.data.ChannelEntity
import de.flown8tive.flowvault.notify.data.ConnectionState
import de.flown8tive.flowvault.notify.data.MessageEntity
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.model.QuietHoursDto
import de.flown8tive.flowvault.notify.push.UnifiedPushManager
import de.flown8tive.flowvault.notify.service.RealtimeSyncService
import de.flown8tive.flowvault.notify.service.SyncWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import okhttp3.sse.EventSource

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as FlowVaultApp
    private val repo = app.repository
    val prefs = app.prefs

    private val _isPaired = MutableStateFlow(prefs.isPaired)
    val isPaired: StateFlow<Boolean> = _isPaired.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _bannerMessage = MutableStateFlow<String?>(null)
    val bannerMessage: StateFlow<String?> = _bannerMessage.asStateFlow()

    private val _activeInstanceId = MutableStateFlow<Int?>(null)

    val connectionState: StateFlow<ConnectionState> = repo.connectionState
    val channels: StateFlow<List<ChannelEntity>> = repo.channelsFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val openAlerts: StateFlow<List<MessageEntity>> = repo.openAlertMessagesFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private var foregroundStream: EventSource? = null
    private var reconnectJob: Job? = null

    init {
        if (prefs.isPaired) {
            refresh()
            startForegroundStream()
        }
    }

    fun clearBanner() {
        _bannerMessage.value = null
    }

    fun setActiveInstance(instanceId: Int?) {
        _activeInstanceId.value = instanceId
        if (instanceId != null && instanceId > 0) {
            viewModelScope.launch {
                runCatching { repo.loadInstanceHistory(instanceId) }
                runCatching { repo.markChannelRead(instanceId) }
            }
        }
    }

    fun messagesForInstance(instanceId: Int): Flow<List<MessageEntity>> = repo.messagesForInstance(instanceId)
    fun searchMessages(query: String): Flow<List<MessageEntity>> = repo.searchMessages(query)

    fun pair(serverUrl: String, code: String, deviceName: String, onSuccess: () -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            _bannerMessage.value = null
            try {
                repo.pair(serverUrl, code, deviceName)
                _isPaired.value = true
                SyncWorker.schedulePeriodic(app)
                startForegroundStream()
                onSuccess()
            } catch (e: Exception) {
                _bannerMessage.value = e.message ?: "Kopplung fehlgeschlagen"
            } finally {
                _busy.value = false
            }
        }
    }

    fun refresh() {
        if (!prefs.isPaired) return
        viewModelScope.launch {
            _busy.value = true
            try {
                repo.syncFull(notifyNew = false)
            } catch (e: Exception) {
                _bannerMessage.value = e.message ?: "Sync fehlgeschlagen"
            } finally {
                _busy.value = false
            }
        }
    }

    fun markChannelRead(instanceId: Int) {
        viewModelScope.launch { runCatching { repo.markChannelRead(instanceId) } }
    }

    fun muteInstance(instanceId: Int, durationMs: Long?) {
        viewModelScope.launch {
            runCatching { repo.muteInstance(instanceId, durationMs) }
                .onSuccess {
                    _bannerMessage.value = if (durationMs == null) "Stummschaltung aufgehoben" else "Kanal stummgeschaltet"
                }
                .onFailure { _bannerMessage.value = it.message }
        }
    }

    fun muteWorkflow(workflowId: Int, durationMs: Long?) {
        viewModelScope.launch {
            runCatching { repo.muteWorkflow(workflowId, durationMs) }
                .onSuccess { _bannerMessage.value = "Workflow stummgeschaltet" }
                .onFailure { _bannerMessage.value = it.message }
        }
    }

    fun dismissAlert(alertId: Int) {
        viewModelScope.launch {
            runCatching { repo.dismissAlert(alertId) }
                .onSuccess { _bannerMessage.value = "Warnung ausgeblendet" }
                .onFailure { _bannerMessage.value = it.message }
        }
    }

    fun setDeliveryMode(mode: DeliveryMode, distributorPackage: String? = null) {
        viewModelScope.launch {
            try {
                when (mode) {
                    DeliveryMode.UNIFIED_PUSH -> {
                        RealtimeSyncService.stop(app)
                        val pkg = distributorPackage ?: UnifiedPushManager.discoverDistributors(app).firstOrNull()?.packageName
                        if (pkg == null) {
                            _bannerMessage.value = "Kein UnifiedPush-Distributor (z. B. ntfy) gefunden"
                            return@launch
                        }
                        prefs.unifiedPushDistributor = pkg
                        prefs.deliveryMode = DeliveryMode.UNIFIED_PUSH
                        UnifiedPushManager.register(app, pkg)
                        _bannerMessage.value = "UnifiedPush-Registrierung angefordert…"
                    }
                    DeliveryMode.REALTIME_SERVICE -> {
                        prefs.unifiedPushDistributor?.let { UnifiedPushManager.unregister(app, it) }
                        repo.updateDelivery(DeliveryMode.REALTIME_SERVICE, null)
                        RealtimeSyncService.start(app)
                        _bannerMessage.value = "Echtzeit-Dienst aktiviert"
                    }
                    DeliveryMode.PERIODIC -> {
                        prefs.unifiedPushDistributor?.let { UnifiedPushManager.unregister(app, it) }
                        RealtimeSyncService.stop(app)
                        repo.updateDelivery(DeliveryMode.PERIODIC, null)
                        SyncWorker.schedulePeriodic(app)
                        _bannerMessage.value = "Periodischer Sync aktiviert"
                    }
                }
            } catch (e: Exception) {
                _bannerMessage.value = e.message ?: "Einstellung konnte nicht gespeichert werden"
            }
        }
    }

    fun saveQuietHours(qh: QuietHoursDto) {
        viewModelScope.launch {
            runCatching { repo.updateQuietHours(qh) }
                .onSuccess { _bannerMessage.value = "Ruhezeiten gespeichert" }
                .onFailure { _bannerMessage.value = it.message }
        }
    }

    fun setHideLockscreen(hide: Boolean) {
        prefs.hideLockscreenDetails = hide
    }

    fun unpair() {
        viewModelScope.launch {
            stopForegroundStream()
            RealtimeSyncService.stop(app)
            SyncWorker.cancelAll(app)
            prefs.unifiedPushDistributor?.let { UnifiedPushManager.unregister(app, it) }
            repo.unpair()
            _isPaired.value = false
        }
    }

    fun startForegroundStream() {
        if (!prefs.isPaired) return
        if (prefs.deliveryMode == DeliveryMode.REALTIME_SERVICE) return // Läuft bereits im Service
        val url = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        foregroundStream?.cancel()
        repo.setConnectionState(ConnectionState.CONNECTING)
        foregroundStream = repo.api.openStream(
            serverUrl = url,
            token = token,
            afterSeq = prefs.latestSeq,
            onConnected = { repo.setConnectionState(ConnectionState.LIVE) },
            onMessage = { dto, isNew ->
                viewModelScope.launch { repo.handleStreamMessage(dto, isNew, _activeInstanceId.value) }
            },
            onFailure = {
                repo.setConnectionState(ConnectionState.OFFLINE)
                reconnectJob?.cancel()
                reconnectJob = viewModelScope.launch {
                    delay(5_000)
                    if (prefs.isPaired) startForegroundStream()
                }
            },
        )
    }

    fun stopForegroundStream() {
        reconnectJob?.cancel()
        foregroundStream?.cancel()
        foregroundStream = null
    }

    override fun onCleared() {
        stopForegroundStream()
        super.onCleared()
    }
}
