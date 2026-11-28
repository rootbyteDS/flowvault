package de.flown8tive.flowvault.notify.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/** 4×2 Startbildschirm-Widget: Golden-Circle System-Puls, Live-Feed & Einhand-Aktionen. */
class FlowVaultMonitorWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        FlowVaultWidgetUpdater.updateAllAsync(context)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        FlowVaultWidgetUpdater.updateAllAsync(context)
    }
}
