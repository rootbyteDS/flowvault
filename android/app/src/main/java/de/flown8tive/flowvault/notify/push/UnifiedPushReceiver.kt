package de.flown8tive.flowvault.notify.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.flown8tive.flowvault.notify.FlowVaultApp
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.service.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Empfängt UnifiedPush-Events.
 * Zero-Payload-Prinzip: Bei `MESSAGE` wird der Inhalt ignoriert und sofort ein direkter HTTPS-Fetch
 * gegen den eigenen FlowVault-Server angestoßen.
 */
class UnifiedPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? FlowVaultApp ?: return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    UnifiedPushManager.ACTION_NEW_ENDPOINT -> {
                        val endpoint = intent.getStringExtra(UnifiedPushManager.EXTRA_ENDPOINT)
                        if (!endpoint.isNullOrBlank()) {
                            runCatching { app.repository.updateDelivery(DeliveryMode.UNIFIED_PUSH, endpoint) }
                        }
                    }
                    UnifiedPushManager.ACTION_MESSAGE -> {
                        // Zero-Payload Tickle → direkt bei FlowVault nachladen (Fallback via WorkManager)
                        val ok = runCatching { app.repository.syncFull(notifyNew = true) }.isSuccess
                        if (!ok) SyncWorker.enqueueImmediate(context)
                    }
                    UnifiedPushManager.ACTION_UNREGISTERED -> {
                        app.prefs.unifiedPushEndpoint = null
                        if (app.prefs.deliveryMode == DeliveryMode.UNIFIED_PUSH) {
                            runCatching { app.repository.updateDelivery(DeliveryMode.PERIODIC, null) }
                        }
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }
}
