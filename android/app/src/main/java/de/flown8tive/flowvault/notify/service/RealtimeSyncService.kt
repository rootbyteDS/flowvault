package de.flown8tive.flowvault.notify.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
 * Optionaler Foreground-Service für Echtzeit-Zustellung im LAN/Tailscale/VPN ganz ohne externen Push-Dienst.
 * Hält einen SSE-Stream (/mobile/v1/stream) mit exponentiellem Backoff offen.
 */
class RealtimeSyncService : Service() {
    companion object {
        fun start(context: Context) {
            val intent = Intent(context, RealtimeSyncService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RealtimeSyncService::class.java))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var eventSource: EventSource? = null
    private var reconnectJob: Job? = null
    private var backoffMs = 2_000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as FlowVaultApp
        val notif = app.notifications.buildForegroundServiceNotification("Verbunden mit FlowVault")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notif)
        }
        if (!app.prefs.isPaired) {
            stopSelf()
            return START_NOT_STICKY
        }
        connect()
        return START_STICKY
    }

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
                backoffMs = 2_000L
                app.repository.setConnectionState(ConnectionState.LIVE)
            },
            onMessage = { dto, isNew ->
                scope.launch { app.repository.handleStreamMessage(dto, isNew) }
            },
            onFailure = {
                app.repository.setConnectionState(ConnectionState.OFFLINE)
                scheduleReconnect()
            },
        )
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
            connect()
        }
    }

    override fun onDestroy() {
        reconnectJob?.cancel()
        eventSource?.cancel()
        (application as? FlowVaultApp)?.repository?.setConnectionState(ConnectionState.OFFLINE)
        scope.cancel()
        super.onDestroy()
    }
}
