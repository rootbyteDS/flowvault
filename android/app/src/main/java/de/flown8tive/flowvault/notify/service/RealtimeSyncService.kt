package de.flown8tive.flowvault.notify.service

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import de.flown8tive.flowvault.notify.FlowVaultApp
import de.flown8tive.flowvault.notify.data.ConnectionState
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.sse.EventSource
import java.util.concurrent.atomic.AtomicLong

/**
 * Stabiler Echtzeit-Hintergrunddienst ohne Live/Offline-Flackern:
 * - Generation-Guard (`streamGen`) verhindert, dass ein geschlossener alter Stream (`Canceled`)
 *   den bereits verbundenen neuen Stream wieder auf `OFFLINE` setzt.
 * - Idempotentes `connect(force = false)` lässt aktive Verbindungen bei mehrfachem Start unangetastet.
 * - `registerDefaultNetworkCallback` beobachtet nur die echte aktive Systemroute (kein Fehlalarm durch Nebennetze).
 * - 12s-Offline-Puffer (`offlineGraceJob`) fängt kurze Proxy-Rotationen (z. B. alle 60–100 s) lautlos ab.
 */
class RealtimeSyncService : Service() {
    companion object {
        const val ACTION_RECONNECT = "de.flown8tive.flowvault.notify.ACTION_RECONNECT"
        private const val OFFLINE_GRACE_MS = 12_000L

        fun start(context: Context) {
            val intent = Intent(context, RealtimeSyncService::class.java)
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }

        fun reconnectNow(context: Context) {
            val intent = Intent(context, RealtimeSyncService::class.java).apply { action = ACTION_RECONNECT }
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RealtimeSyncService::class.java))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val streamGen = AtomicLong(0L)

    @Volatile
    private var eventSource: EventSource? = null

    @Volatile
    private var streamActiveOrConnecting = false

    private var reconnectJob: Job? = null
    private var offlineGraceJob: Job? = null
    private var backoffMs = 800L
    private var networkCallbackRegistered = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            backoffMs = 800L
            reconnectJob?.cancel()
            scope.launch {
                val app = application as? FlowVaultApp ?: return@launch
                if (!app.prefs.isPaired) return@launch
                connect(force = false)
                runCatching { app.repository.syncFull(notifyNew = true) }
            }
        }

        override fun onLost(network: Network) {
            if (!hasActiveInternet()) {
                streamActiveOrConnecting = false
                offlineGraceJob?.cancel()
                (application as? FlowVaultApp)?.repository?.setConnectionState(ConnectionState.OFFLINE)
                updateServiceNotification("Warte auf Netzwerkverbindung…")
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        registerNetworkWatcher()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as FlowVaultApp
        val statusText = if (app.repository.connectionState.value == ConnectionState.LIVE) {
            "Echtzeit-Schutz aktiv · Live verbunden"
        } else {
            "Verbinde Echtzeit-Schutz…"
        }
        val notif = app.notifications.buildForegroundServiceNotification(statusText)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NotificationHelper.SERVICE_NOTIFICATION_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notif)
        }
        if (!app.prefs.isPaired) {
            stopSelf()
            return START_NOT_STICKY
        }

        val forceReconnect = intent?.action == ACTION_RECONNECT
        if (forceReconnect) {
            backoffMs = 800L
            reconnectJob?.cancel()
        }
        connect(force = forceReconnect)
        if (forceReconnect || app.prefs.lastSyncAt == 0L) {
            scope.launch { runCatching { app.repository.syncFull(notifyNew = true) } }
        }
        return START_STICKY
    }

    @Synchronized
    private fun connect(force: Boolean = false) {
        val app = application as FlowVaultApp
        val url = app.prefs.serverUrl ?: return
        val token = app.prefs.deviceToken ?: return

        if (!force && eventSource != null && streamActiveOrConnecting) {
            return
        }

        val myGen = streamGen.incrementAndGet()
        val previous = eventSource
        eventSource = null
        streamActiveOrConnecting = true
        previous?.cancel()

        val curState = app.repository.connectionState.value
        if (curState == ConnectionState.OFFLINE) {
            app.repository.setConnectionState(ConnectionState.CONNECTING)
        }

        eventSource = app.api.openStream(
            serverUrl = url,
            token = token,
            afterSeq = app.prefs.latestSeq,
            onConnected = {
                if (myGen != streamGen.get()) return@openStream
                backoffMs = 800L
                streamActiveOrConnecting = true
                offlineGraceJob?.cancel()
                reconnectJob?.cancel()
                app.repository.recordHeartbeat()
                app.repository.setConnectionState(ConnectionState.LIVE)
                updateServiceNotification("Echtzeit-Schutz aktiv · Live verbunden")
            },
            onHeartbeat = {
                if (myGen != streamGen.get()) return@openStream
                offlineGraceJob?.cancel()
                app.repository.recordHeartbeat()
                app.repository.setConnectionState(ConnectionState.LIVE)
            },
            onMessage = { dto, isNew ->
                if (myGen != streamGen.get()) return@openStream
                offlineGraceJob?.cancel()
                scope.launch { app.repository.handleStreamMessage(dto, isNew) }
            },
            onFailure = {
                if (myGen != streamGen.get()) return@openStream
                streamActiveOrConnecting = false
                eventSource = null
                if (!hasActiveInternet()) {
                    offlineGraceJob?.cancel()
                    app.repository.setConnectionState(ConnectionState.OFFLINE)
                    updateServiceNotification("Warte auf Netzwerkverbindung…")
                } else {
                    startOfflineGraceTimer()
                    scheduleReconnect()
                }
            },
        )
    }

    private fun startOfflineGraceTimer() {
        if (offlineGraceJob?.isActive == true) return
        offlineGraceJob = scope.launch {
            delay(OFFLINE_GRACE_MS)
            val app = application as? FlowVaultApp ?: return@launch
            if (!streamActiveOrConnecting || app.repository.connectionState.value != ConnectionState.LIVE) {
                app.repository.setConnectionState(ConnectionState.OFFLINE)
                updateServiceNotification("Verbindung getrennt · verbinde neu…")
            }
        }
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val wait = backoffMs
            backoffMs = (backoffMs * 2).coerceAtMost(25_000L)
            delay(wait)
            connect(force = true)
        }
    }

    private fun hasActiveInternet(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val active = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun updateServiceNotification(status: String) {
        val app = application as? FlowVaultApp ?: return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        runCatching {
            nm.notify(NotificationHelper.SERVICE_NOTIFICATION_ID, app.notifications.buildForegroundServiceNotification(status))
        }
    }

    private fun registerNetworkWatcher() {
        if (networkCallbackRegistered) return
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        runCatching {
            cm.registerDefaultNetworkCallback(networkCallback)
            networkCallbackRegistered = true
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val app = application as? FlowVaultApp
        if (app?.prefs?.isPaired == true) {
            SyncWorker.enqueueImmediate(this)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        streamGen.incrementAndGet()
        if (networkCallbackRegistered) {
            runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(networkCallback) }
            networkCallbackRegistered = false
        }
        offlineGraceJob?.cancel()
        reconnectJob?.cancel()
        eventSource?.cancel()
        eventSource = null
        streamActiveOrConnecting = false
        (application as? FlowVaultApp)?.repository?.setConnectionState(ConnectionState.OFFLINE)
        scope.cancel()
        super.onDestroy()
    }
}
