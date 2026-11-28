package de.flown8tive.flowvault.notify.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import de.flown8tive.flowvault.notify.MainActivity
import de.flown8tive.flowvault.notify.R
import de.flown8tive.flowvault.notify.data.SecurePrefs
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.model.MessageDto

class NotificationHelper(
    private val context: Context,
    private val prefs: SecurePrefs,
) {
    companion object {
        const val CHANNEL_CRITICAL = "fv_critical"
        const val CHANNEL_FAILURES = "fv_failures"
        const val CHANNEL_CHANGES = "fv_changes"
        const val CHANNEL_SERVICE = "fv_service"

        const val SERVICE_NOTIFICATION_ID = 9001
        const val EXTRA_OPEN_INSTANCE_ID = "open_instance_id"
        const val EXTRA_OPEN_TAB = "open_tab"
    }

    fun ensureChannels() {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            NotificationChannel(CHANNEL_CRITICAL, "Kritische Warnungen & Sync-Ausfälle", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Health-Regressionen, steigende Fehlerquoten und nicht erreichbare n8n-Instanzen"
                enableVibration(true)
            },
            NotificationChannel(CHANNEL_FAILURES, "Workflow-Fehlläufe", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Gruppierte Fehlläufe und Ausführungsprobleme"
            },
            NotificationChannel(CHANNEL_CHANGES, "Workflow-Änderungen", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Neue Versionen, Wiederherstellungen, Übernahmen und Entwarnungen"
            },
            NotificationChannel(CHANNEL_SERVICE, "Echtzeit-Verbindung", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Dauerhafte Verbindung zu FlowVault ohne externen Push-Dienst"
                setShowBadge(false)
            },
        )
        channels.forEach { nm.createNotificationChannel(it) }
    }

    fun buildForegroundServiceNotification(statusText: String): Notification {
        ensureChannels()
        val openIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("FlowVault Notify")
            .setContentText(statusText)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openIntent)
            .build()
    }

    fun showMessage(msg: MessageDto, recentInChannel: List<MessageDto>) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }
        ensureChannels()

        val channelId = MessageCategoryHelper.channelIdFor(msg.kind, msg.severity)
        val groupKey = "flowvault_instance_${msg.instance.id}"
        val notifId = 1000 + msg.instance.id

        val openIntent = PendingIntent.getActivity(
            context,
            notifId,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_OPEN_INSTANCE_ID, msg.instance.id)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val me = Person.Builder().setName("Du").build()
        val style = NotificationCompat.MessagingStyle(me)
            .setConversationTitle(msg.instance.name)
            .setGroupConversation(true)

        val ordered = (recentInChannel.filter { it.seq != msg.seq } + msg)
            .sortedBy { it.updatedAt }
            .takeLast(5)

        for (item in ordered) {
            val senderLabel = buildString {
                append(MessageCategoryHelper.badgeLabel(item.kind))
                item.workflow?.let { append(" · ").append(it.name) }
                if (item.groupCount > 1) append(" (×${item.groupCount})")
            }
            val sender = Person.Builder().setName(senderLabel).build()
            val text = item.metadata.aiSummary?.title?.let { "$it — ${item.body}" } ?: item.body
            style.addMessage(text, item.updatedAt, sender)
        }

        val publicFallback = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("FlowVault · ${msg.instance.name}")
            .setContentText("Neue Meldung eingegangen")
            .build()

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setStyle(style)
            .setContentTitle(msg.title)
            .setContentText(msg.body)
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .setGroup(groupKey)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(
                if (prefs.hideLockscreenDetails || prefs.redactionMode == "lockscreen") {
                    NotificationCompat.VISIBILITY_PRIVATE
                } else {
                    NotificationCompat.VISIBILITY_PUBLIC
                },
            )
            .setPublicVersion(publicFallback)

        // Direktaktionen: Als gelesen, 1h stumm, ggf. Warnung ausblenden
        builder.addAction(
            0,
            "Als gelesen",
            actionIntent(NotificationActionReceiver.ACTION_MARK_READ, msg.instance.id, msg.updatedSeq, msg.alertId, notifId * 10 + 1),
        )
        builder.addAction(
            0,
            "1h stumm",
            actionIntent(NotificationActionReceiver.ACTION_MUTE_1H, msg.instance.id, msg.updatedSeq, msg.alertId, notifId * 10 + 2),
        )
        if ((msg.kind == "alert_opened" || msg.kind == "alert_escalated") && msg.alertId != null) {
            builder.addAction(
                0,
                "Ausblenden",
                actionIntent(NotificationActionReceiver.ACTION_DISMISS_ALERT, msg.instance.id, msg.updatedSeq, msg.alertId, notifId * 10 + 3),
            )
        }

        NotificationManagerCompat.from(context).notify(notifId, builder.build())
    }

    fun cancelInstanceNotifications(instanceId: Int) {
        NotificationManagerCompat.from(context).cancel(1000 + instanceId)
    }

    private fun actionIntent(action: String, instanceId: Int, readSeq: Long, alertId: Int?, requestCode: Int): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            this.action = action
            putExtra(NotificationActionReceiver.EXTRA_INSTANCE_ID, instanceId)
            putExtra(NotificationActionReceiver.EXTRA_READ_SEQ, readSeq)
            if (alertId != null) putExtra(NotificationActionReceiver.EXTRA_ALERT_ID, alertId)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
