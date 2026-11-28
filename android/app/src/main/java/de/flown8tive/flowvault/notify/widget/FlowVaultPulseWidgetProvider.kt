package de.flown8tive.flowvault.notify.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/** Kompaktes 2×1 Startbildschirm-Widget für die untere Daumen-Reihe. */
class FlowVaultPulseWidgetProvider : AppWidgetProvider() {
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
