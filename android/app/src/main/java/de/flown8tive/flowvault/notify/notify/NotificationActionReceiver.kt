package de.flown8tive.flowvault.notify.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.flown8tive.flowvault.notify.FlowVaultApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Verarbeitet Direktaktionen aus Android-Benachrichtigungen ohne die App zu öffnen. */
class NotificationActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_MARK_READ = "de.flown8tive.flowvault.notify.ACTION_MARK_READ"
        const val ACTION_MUTE_1H = "de.flown8tive.flowvault.notify.ACTION_MUTE_1H"
        const val ACTION_DISMISS_ALERT = "de.flown8tive.flowvault.notify.ACTION_DISMISS_ALERT"

        const val EXTRA_INSTANCE_ID = "instance_id"
        const val EXTRA_READ_SEQ = "read_seq"
        const val EXTRA_ALERT_ID = "alert_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? FlowVaultApp ?: return
        val instanceId = intent.getIntExtra(EXTRA_INSTANCE_ID, 0)
        val readSeq = intent.getLongExtra(EXTRA_READ_SEQ, 0L)
        val alertId = intent.getIntExtra(EXTRA_ALERT_ID, 0)
        val pending = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_MARK_READ -> if (instanceId > 0) app.repository.markChannelRead(instanceId, readSeq)
                    ACTION_MUTE_1H -> {
                        if (instanceId > 0) {
                            app.repository.muteInstance(instanceId, 3_600_000L)
                            app.notifications.cancelInstanceNotifications(instanceId)
                        }
                    }
                    ACTION_DISMISS_ALERT -> {
                        if (alertId > 0) app.repository.dismissAlert(alertId)
                        if (instanceId > 0) app.notifications.cancelInstanceNotifications(instanceId)
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }
}
