package de.flown8tive.flowvault.notify.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import de.flown8tive.flowvault.notify.FlowVaultApp
import de.flown8tive.flowvault.notify.MainActivity
import de.flown8tive.flowvault.notify.R
import de.flown8tive.flowvault.notify.data.ConnectionState
import de.flown8tive.flowvault.notify.data.FlowVaultDatabase
import de.flown8tive.flowvault.notify.data.SecurePrefs
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object FlowVaultWidgetUpdater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun updateAllAsync(context: Context) {
        val appCtx = context.applicationContext
        scope.launch {
            runCatching { updateAllNow(appCtx) }
        }
    }

    suspend fun updateAllNow(context: Context) {
        val appCtx = context.applicationContext
        val manager = AppWidgetManager.getInstance(appCtx) ?: return
        val monitorIds = manager.getAppWidgetIds(ComponentName(appCtx, FlowVaultMonitorWidgetProvider::class.java))
        val pulseIds = manager.getAppWidgetIds(ComponentName(appCtx, FlowVaultPulseWidgetProvider::class.java))
        if (monitorIds.isEmpty() && pulseIds.isEmpty()) return

        val app = appCtx as? FlowVaultApp
        val prefs = app?.prefs ?: SecurePrefs(appCtx)
        val dao = (app?.db ?: FlowVaultDatabase.get(appCtx)).dao()
        val connState = app?.repository?.connectionState?.value ?: if (prefs.isPaired) ConnectionState.SYNCED else ConnectionState.OFFLINE

        val snapshot = FlowVaultWidgetSnapshot.build(
            isPaired = prefs.isPaired,
            connectionState = connState,
            channels = if (prefs.isPaired) dao.getAllChannelsSnapshot() else emptyList(),
            openAlerts = if (prefs.isPaired) dao.getOpenAlertsSnapshot() else emptyList(),
            unreadMessages = if (prefs.isPaired) dao.getUnreadMessagesSnapshot() else emptyList(),
            recentMessages = if (prefs.isPaired) dao.getRecentMessagesSnapshot() else emptyList(),
        )

        for (id in monitorIds) {
            manager.updateAppWidget(id, buildMonitorRemoteViews(appCtx, id, snapshot))
        }
        for (id in pulseIds) {
            manager.updateAppWidget(id, buildPulseRemoteViews(appCtx, id, snapshot))
        }
    }

    fun canRequestPin(context: Context): Boolean =
        AppWidgetManager.getInstance(context)?.isRequestPinAppWidgetSupported == true

    fun requestPinMonitorWidget(context: Context): Boolean {
        val mgr = AppWidgetManager.getInstance(context) ?: return false
        if (!mgr.isRequestPinAppWidgetSupported) return false
        return mgr.requestPinAppWidget(ComponentName(context, FlowVaultMonitorWidgetProvider::class.java), null, null)
    }

    fun requestPinPulseWidget(context: Context): Boolean {
        val mgr = AppWidgetManager.getInstance(context) ?: return false
        if (!mgr.isRequestPinAppWidgetSupported) return false
        return mgr.requestPinAppWidget(ComponentName(context, FlowVaultPulseWidgetProvider::class.java), null, null)
    }

    private fun buildMonitorRemoteViews(context: Context, widgetId: Int, snap: WidgetSnapshotModel): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_flowvault_monitor)
        views.setInt(R.id.widget_status_box, "setBackgroundResource", headerDrawableFor(snap.tone))
        views.setImageViewResource(R.id.widget_status_dot, dotDrawableFor(snap.tone))
        views.setTextViewText(R.id.widget_title, snap.headline)
        views.setTextViewText(R.id.widget_subtitle, snap.subtitle)
        views.setTextViewText(R.id.widget_conn_badge, snap.connectionBadge)
        views.setTextColor(
            R.id.widget_conn_badge,
            when (snap.connectionBadge) {
                "LIVE" -> Color.parseColor("#4CC38A")
                "OFFLINE" -> Color.parseColor("#E5484D")
                else -> Color.parseColor("#E39A70")
            },
        )

        val openTabIntent = openAppTabPendingIntent(context, snap.openTabTarget, widgetId * 20 + 1)
        views.setOnClickPendingIntent(R.id.widget_status_box, openTabIntent)
        views.setTextViewText(R.id.widget_btn_open, snap.openButtonLabel)
        views.setOnClickPendingIntent(R.id.widget_btn_open, openTabIntent)

        views.setViewVisibility(R.id.widget_btn_mark_read, if (snap.showMarkAllRead) View.VISIBLE else View.GONE)
        views.setOnClickPendingIntent(
            R.id.widget_btn_mark_read,
            broadcastPendingIntent(context, WidgetActionReceiver.ACTION_MARK_ALL_READ, widgetId * 20 + 2),
        )
        views.setOnClickPendingIntent(
            R.id.widget_btn_sync,
            broadcastPendingIntent(context, WidgetActionReceiver.ACTION_SYNC_NOW, widgetId * 20 + 3),
        )

        val rowIds = listOf(
            Triple(R.id.widget_row_1, R.id.widget_row_1_dot, R.id.widget_row_1_title to R.id.widget_row_1_meta),
            Triple(R.id.widget_row_2, R.id.widget_row_2_dot, R.id.widget_row_2_title to R.id.widget_row_2_meta),
            Triple(R.id.widget_row_3, R.id.widget_row_3_dot, R.id.widget_row_3_title to R.id.widget_row_3_meta),
        )

        if (snap.rows.isEmpty()) {
            views.setViewVisibility(R.id.widget_empty_text, View.VISIBLE)
            rowIds.forEach { (rowId, _, _) -> views.setViewVisibility(rowId, View.GONE) }
        } else {
            views.setViewVisibility(R.id.widget_empty_text, View.GONE)
            rowIds.forEachIndexed { idx, (rowId, dotId, textPair) ->
                val item = snap.rows.getOrNull(idx)
                if (item == null) {
                    views.setViewVisibility(rowId, View.GONE)
                } else {
                    views.setViewVisibility(rowId, View.VISIBLE)
                    views.setImageViewResource(dotId, dotDrawableFor(item.tone))
                    views.setTextViewText(textPair.first, item.title)
                    views.setTextViewText(textPair.second, item.meta)
                    views.setOnClickPendingIntent(
                        rowId,
                        openInstancePendingIntent(context, item.instanceId, widgetId * 20 + 10 + idx),
                    )
                }
            }
        }
        return views
    }

    private fun buildPulseRemoteViews(context: Context, widgetId: Int, snap: WidgetSnapshotModel): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_flowvault_pulse)
        views.setImageViewResource(R.id.pulse_dot, dotDrawableFor(snap.tone))
        views.setTextViewText(R.id.pulse_title, snap.compactTitle)
        views.setTextViewText(R.id.pulse_subtitle, snap.compactSubtitle)
        views.setOnClickPendingIntent(
            R.id.pulse_root,
            openAppTabPendingIntent(context, snap.openTabTarget, widgetId * 20 + 50),
        )
        views.setOnClickPendingIntent(
            R.id.pulse_btn_sync,
            broadcastPendingIntent(context, WidgetActionReceiver.ACTION_SYNC_NOW, widgetId * 20 + 51),
        )
        return views
    }

    private fun headerDrawableFor(tone: WidgetTone): Int = when (tone) {
        WidgetTone.CRITICAL -> R.drawable.widget_header_critical
        WidgetTone.UNREAD -> R.drawable.widget_header_unread
        WidgetTone.CALM -> R.drawable.widget_header_calm
        WidgetTone.UNPAIRED -> R.drawable.widget_header_neutral
    }

    private fun dotDrawableFor(tone: WidgetTone): Int = when (tone) {
        WidgetTone.CRITICAL -> R.drawable.widget_dot_red
        WidgetTone.UNREAD -> R.drawable.widget_dot_amber
        WidgetTone.CALM -> R.drawable.widget_dot_green
        WidgetTone.UNPAIRED -> R.drawable.widget_dot_gray
    }

    private fun openAppTabPendingIntent(context: Context, tab: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(NotificationHelper.EXTRA_OPEN_TAB, tab)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun openInstancePendingIntent(context: Context, instanceId: Int, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(NotificationHelper.EXTRA_OPEN_INSTANCE_ID, instanceId)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun broadcastPendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, WidgetActionReceiver::class.java).apply {
            this.action = action
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
