package de.flown8tive.flowvault.notify.push

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Standard-UnifiedPush-Protokoll (v2) ohne Fremd-Repository-Abhängigkeit:
 * Entdeckt installierte Distributoren (z. B. ntfy, Sunup, NextPush) und registriert/deregistriert die App.
 */
object UnifiedPushManager {
    const val ACTION_REGISTER = "org.unifiedpush.android.distributor.REGISTER"
    const val ACTION_UNREGISTER = "org.unifiedpush.android.distributor.UNREGISTER"

    const val ACTION_NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT"
    const val ACTION_MESSAGE = "org.unifiedpush.android.connector.MESSAGE"
    const val ACTION_UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED"
    const val ACTION_REGISTRATION_FAILED = "org.unifiedpush.android.connector.REGISTRATION_FAILED"

    const val EXTRA_APPLICATION = "application"
    const val EXTRA_TOKEN = "token"
    const val EXTRA_ENDPOINT = "endpoint"

    private const val INSTANCE_TOKEN = "flowvault_default"

    data class DistributorInfo(val packageName: String, val label: String)

    fun discoverDistributors(context: Context): List<DistributorInfo> {
        val pm = context.packageManager
        val intent = Intent(ACTION_REGISTER)
        val matches = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryBroadcastReceivers(intent, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.queryBroadcastReceivers(intent, 0)
        }
        return matches.mapNotNull { ri ->
            val pkg = ri.activityInfo?.packageName ?: return@mapNotNull null
            val label = runCatching {
                pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
            }.getOrDefault(pkg)
            DistributorInfo(pkg, label)
        }.distinctBy { it.packageName }
    }

    fun register(context: Context, distributorPackage: String) {
        val intent = Intent(ACTION_REGISTER).apply {
            `package` = distributorPackage
            putExtra(EXTRA_APPLICATION, context.packageName)
            putExtra(EXTRA_TOKEN, INSTANCE_TOKEN)
        }
        context.sendBroadcast(intent)
    }

    fun unregister(context: Context, distributorPackage: String) {
        val intent = Intent(ACTION_UNREGISTER).apply {
            `package` = distributorPackage
            putExtra(EXTRA_TOKEN, INSTANCE_TOKEN)
        }
        context.sendBroadcast(intent)
    }
}
