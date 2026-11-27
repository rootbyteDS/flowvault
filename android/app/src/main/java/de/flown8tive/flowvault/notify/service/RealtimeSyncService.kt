package de.flown8tive.flowvault.notify.service

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
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

/**
 * Zuverlässiger Echtzeit-Hintergrunddienst (specialUse FGS ohne 6h-Timeout unter Android 14/15):
 * - Überwacht WLAN-/Mobilfunkwechsel aktiv via `ConnectivityManager.NetworkCallback`
 * - Erkennt tote („half-open“) Sockets über 45s-Read-Timeout gegen den 20s-Server-Heartbeat
 * - Holt nach jedem Reconnect per `syncFull` verpasste Nachrichten lückenlos nach
 */
class RealtimeSyncService : Service() {
    companion object {
        const val ACTION_RECONNECT = "de.flown8tive.flowvault.notify.ACTION_RECONNECT"

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
    private var eventSource: EventSource? = null
    private var reconnectJob: Job? = null
    private var backoffMs = 1_500L
    private var networkCallbackRegistered = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            backoffMs = 1_000L
            reconnectJob?.cancel()
            scope.launch {
                val app = application as? FlowVaultApp ?: return@launch
                if (!app.prefs.isPaired) return@launch
                connect()
                runCatching { app.repository.syncFull(notifyNew = true) }
            }
        }

        override fun onLost(network: Network) {
            (application as? FlowVaultApp)?.repository?.setConnectionState(ConnectionState.OFFLINE)
            updateServiceNotification("Warte auf Netzwerkverbindung…")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        registerNetworkWatcher()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as FlowVaultApp
        val notif = app.notifications.buildForegroundServiceNotification("Verbinde Echtzeit-Schutz…")
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
        if (intent?.action == ACTION_RECONNECT) {
            backoffMs = 1_000L
            reconnectJob?.cancel()
        }
        connect()
        scope.launch { runCatching { app.repository.syncFull(notifyNew = true) } }
        return START_STICKY
    }

    @Synchronized
    private fun connect() {
        val app = application as FlowVaultApp
        val url = app.prefs.serverUrl ?: return
        val token = app.prefs.deviceToken ?: return
        eventSource?.cancel()
        app.repository.setConnectionState(ConnectionState.CONNECTING)

        eventSource = app.api.openStream(
            serverUrl = url,
            token = token,
            afterSeq = app.prefs.latestSeq,
            onConnected = {
                backoffMs = 1_500L
                app.repository.recordHeartbeat()
                app.repository.setConnectionState(ConnectionState.LIVE)
                updateServiceNotification("Echtzeit-Schutz aktiv · Live verbunden")
            },
            onHeartbeat = {
                app.repository.recordHeartbeat()
            },
            onMessage = { dto, isNew ->
                scope.launch { app.repository.handleStreamMessage(dto, isNew) }
            },
            onFailure = {
                app.repository.setConnectionState(ConnectionState.OFFLINE)
                updateServiceNotification("Verbindung getrennt · verbinde neu…")
                scheduleReconnect()
            },
        )
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val wait = backoffMs
            backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            delay(wait)
            connect()
        }
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
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching {
            cm.registerNetworkCallback(req, networkCallback)
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
        if (networkCallbackRegistered) {
            runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(networkCallback) }
            networkCallbackRegistered = false
        }
        reconnectJob?.cancel()
        eventSource?.cancel()
        (application as? FlowVaultApp)?.repository?.setConnectionState(ConnectionState.OFFLINE)
        scope.cancel()
        super.onDestroy()
    }
}
