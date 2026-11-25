package de.flown8tive.flowvault.notify.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.flown8tive.flowvault.notify.FlowVaultApp
import de.flown8tive.flowvault.notify.model.DeliveryMode

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext as? FlowVaultApp ?: return
        if (!app.prefs.isPaired) return
        SyncWorker.schedulePeriodic(context)
        if (app.prefs.deliveryMode == DeliveryMode.REALTIME_SERVICE) {
            RealtimeSyncService.start(context)
        }
    }
}
