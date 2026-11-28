package de.flown8tive.flowvault.notify.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.flown8tive.flowvault.notify.FlowVaultApp
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.service.RealtimeSyncService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Verarbeitet Schnellaktionen direkt aus den Startbildschirm-Widgets ohne App-Start. */
class WidgetActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_SYNC_NOW = "de.flown8tive.flowvault.notify.WIDGET_SYNC_NOW"
        const val ACTION_MARK_ALL_READ = "de.flown8tive.flowvault.notify.WIDGET_MARK_ALL_READ"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? FlowVaultApp ?: return
        if (!app.prefs.isPaired) {
            FlowVaultWidgetUpdater.updateAllAsync(context)
            return
        }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_SYNC_NOW -> {
                        if (app.prefs.deliveryMode == DeliveryMode.REALTIME_SERVICE) {
                            RealtimeSyncService.reconnectNow(context)
                        }
                        runCatching { app.repository.syncFull(notifyNew = true) }
                    }
                    ACTION_MARK_ALL_READ -> {
                        runCatching { app.repository.markAllRead() }
                    }
                }
                FlowVaultWidgetUpdater.updateAllNow(context)
            } finally {
                pending.finish()
            }
        }
    }
}
