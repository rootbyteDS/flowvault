package de.flown8tive.flowvault.notify

import android.app.Application
import de.flown8tive.flowvault.notify.data.FlowVaultApi
import de.flown8tive.flowvault.notify.data.FlowVaultDatabase
import de.flown8tive.flowvault.notify.data.NotifyRepository
import de.flown8tive.flowvault.notify.data.SecurePrefs
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import de.flown8tive.flowvault.notify.service.RealtimeSyncService
import de.flown8tive.flowvault.notify.service.SyncWorker

class FlowVaultApp : Application() {
    lateinit var prefs: SecurePrefs
        private set
    lateinit var db: FlowVaultDatabase
        private set
    lateinit var api: FlowVaultApi
        private set
    lateinit var notifications: NotificationHelper
        private set
    lateinit var repository: NotifyRepository
        private set

    override fun onCreate() {
        super.onCreate()
        prefs = SecurePrefs(this)
        db = FlowVaultDatabase.get(this)
        api = FlowVaultApi()
        notifications = NotificationHelper(this, prefs)
        notifications.ensureChannels()
        repository = NotifyRepository(this, prefs, db, api, notifications)

        if (prefs.isPaired) {
            SyncWorker.schedulePeriodic(this)
            if (prefs.deliveryMode == DeliveryMode.REALTIME_SERVICE) {
                RealtimeSyncService.start(this)
            }
        }
    }
}
