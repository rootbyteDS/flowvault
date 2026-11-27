package de.flown8tive.flowvault.notify.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import de.flown8tive.flowvault.notify.model.QuietHoursDto
import kotlinx.serialization.encodeToString

/** Verschlüsselte Ablage für Server-URL, Gerätetoken (`fv_app_…`) und lokale Einstellungen. */
class SecurePrefs(context: Context) {
    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "flowvault_notify_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(value) = prefs.edit().putString("server_url", value?.trimEnd('/')).apply()

    var deviceToken: String?
        get() = prefs.getString("device_token", null)
        set(value) = prefs.edit().putString("device_token", value).apply()

    var deviceId: Int
        get() = prefs.getInt("device_id", 0)
        set(value) = prefs.edit().putInt("device_id", value).apply()

    var deviceName: String
        get() = prefs.getString("device_name", android.os.Build.MODEL ?: "Android") ?: "Android"
        set(value) = prefs.edit().putString("device_name", value).apply()

    var serverVersion: String
        get() = prefs.getString("server_version", "") ?: ""
        set(value) = prefs.edit().putString("server_version", value).apply()

    var redactionMode: String
        get() = prefs.getString("redaction_mode", "lockscreen") ?: "lockscreen"
        set(value) = prefs.edit().putString("redaction_mode", value).apply()

    var allowRollback: Boolean
        get() = prefs.getBoolean("allow_rollback", false)
        set(value) = prefs.edit().putBoolean("allow_rollback", value).apply()

    var e2ePublicKey: String?
        get() = prefs.getString("e2e_public_key", null)
        set(value) = prefs.edit().putString("e2e_public_key", value).apply()

    var e2ePrivateKey: String?
        get() = prefs.getString("e2e_private_key", null)
        set(value) = prefs.edit().putString("e2e_private_key", value).apply()

    var deliveryMode: DeliveryMode
        get() = DeliveryMode.fromWire(prefs.getString("delivery_mode", DeliveryMode.REALTIME_SERVICE.wireValue))
        set(value) = prefs.edit().putString("delivery_mode", value.wireValue).apply()

    var unifiedPushDistributor: String?
        get() = prefs.getString("up_distributor", null)
        set(value) = prefs.edit().putString("up_distributor", value).apply()

    var unifiedPushEndpoint: String?
        get() = prefs.getString("up_endpoint", null)
        set(value) = prefs.edit().putString("up_endpoint", value).apply()

    var hideLockscreenDetails: Boolean
        get() = prefs.getBoolean("hide_lockscreen", true)
        set(value) = prefs.edit().putBoolean("hide_lockscreen", value).apply()

    var latestSeq: Long
        get() = prefs.getLong("latest_seq", 0L)
        set(value) = prefs.edit().putLong("latest_seq", value).apply()

    var lastSyncAt: Long
        get() = prefs.getLong("last_sync_at", 0L)
        set(value) = prefs.edit().putLong("last_sync_at", value).apply()

    var lastHeartbeatAt: Long
        get() = prefs.getLong("last_heartbeat_at", 0L)
        set(value) = prefs.edit().putLong("last_heartbeat_at", value).apply()

    var quietHours: QuietHoursDto
        get() {
            val raw = prefs.getString("quiet_hours", null) ?: return QuietHoursDto()
            return runCatching { FlowVaultJson.decodeFromString<QuietHoursDto>(raw) }.getOrDefault(QuietHoursDto())
        }
        set(value) = prefs.edit().putString("quiet_hours", FlowVaultJson.encodeToString(value)).apply()

    val isPaired: Boolean
        get() = !serverUrl.isNullOrBlank() && !deviceToken.isNullOrBlank()

    fun clearAll() {
        prefs.edit().clear().apply()
    }
}
