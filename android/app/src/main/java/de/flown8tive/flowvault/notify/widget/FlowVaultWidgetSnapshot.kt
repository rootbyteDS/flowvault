package de.flown8tive.flowvault.notify.widget

import de.flown8tive.flowvault.notify.data.ChannelEntity
import de.flown8tive.flowvault.notify.data.ConnectionState
import de.flown8tive.flowvault.notify.data.MessageEntity
import de.flown8tive.flowvault.notify.model.GoldenCircleCopy
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class WidgetTone {
    UNPAIRED,
    CALM,
    UNREAD,
    CRITICAL,
}

data class WidgetRowItem(
    val instanceId: Int,
    val title: String,
    val meta: String,
    val tone: WidgetTone,
)

data class WidgetSnapshotModel(
    val tone: WidgetTone,
    val headline: String,
    val subtitle: String,
    val compactTitle: String,
    val compactSubtitle: String,
    val connectionBadge: String,
    val openTabTarget: String,
    val openButtonLabel: String,
    val showMarkAllRead: Boolean,
    val rows: List<WidgetRowItem>,
)

object FlowVaultWidgetSnapshot {
    fun build(
        isPaired: Boolean,
        connectionState: ConnectionState,
        channels: List<ChannelEntity>,
        openAlerts: List<MessageEntity>,
        unreadMessages: List<MessageEntity>,
        recentMessages: List<MessageEntity>,
        nowMs: Long = System.currentTimeMillis(),
    ): WidgetSnapshotModel {
        if (!isPaired) {
            return WidgetSnapshotModel(
                tone = WidgetTone.UNPAIRED,
                headline = "FlowVault noch nicht gekoppelt",
                subtitle = "Tippe, um den QR-Code deiner Instanz zu scannen",
                compactTitle = "Nicht gekoppelt",
                compactSubtitle = "Tippen zum Verbinden",
                connectionBadge = "SETUP",
                openTabTarget = "channels",
                openButtonLabel = "Jetzt koppeln",
                showMarkAllRead = false,
                rows = emptyList(),
            )
        }

        val totalUnread = channels.sumOf { it.unreadCount }
        val channelAlerts = channels.sumOf { it.openAlerts }
        val criticalCount = maxOf(openAlerts.size, channelAlerts)
        val connBadge = when (connectionState) {
            ConnectionState.LIVE -> "LIVE"
            ConnectionState.SYNCED -> "SYNC"
            ConnectionState.CONNECTING -> "…"
            ConnectionState.OFFLINE -> "OFFLINE"
        }

        val tone: WidgetTone
        val headline: String
        val subtitle: String
        val compactTitle: String
        val compactSub: String
        val openTab: String
        val openLabel: String

        when {
            criticalCount > 0 -> {
                tone = WidgetTone.CRITICAL
                headline = "$criticalCount kritische Störung${if (criticalCount == 1) "" else "en"}"
                subtitle = "Handlungsbedarf – Ursache prüfen oder zurückspielen"
                compactTitle = "$criticalCount Kritisch!"
                compactSub = "Sofort im Fokus prüfen"
                openTab = "focus"
                openLabel = "Störungen klären ($criticalCount)"
            }
            totalUnread > 0 -> {
                tone = WidgetTone.UNREAD
                headline = "$totalUnread ungelesene Meldung${if (totalUnread == 1) "" else "en"}"
                subtitle = "Keine aktive Regression · bereit zur Durchsicht"
                compactTitle = "$totalUnread Ungelesen"
                compactSub = "${channels.size} Instanz${if (channels.size == 1) "" else "en"} überwacht"
                openTab = "focus"
                openLabel = "Fokus öffnen ($totalUnread)"
            }
            else -> {
                tone = WidgetTone.CALM
                headline = "Alle Systeme ruhig"
                subtitle = "${channels.size} Instanz${if (channels.size == 1) "" else "en"} überwacht · Echtzeit-Schutz aktiv"
                compactTitle = "Alles ruhig"
                compactSub = "${channels.size} Instanz${if (channels.size == 1) "" else "en"} · $connBadge"
                openTab = "channels"
                openLabel = "Instanzen öffnen"
            }
        }

        // Priorisierte Zeilen: 1) Offene kritische Alarme, 2) Ungelesene Meldungen, 3) Überwachte Kanäle / letzte Events
        val rows = mutableListOf<WidgetRowItem>()
        val seenSeqs = mutableSetOf<Long>()

        for (msg in openAlerts) {
            if (rows.size >= 3) break
            seenSeqs += msg.seq
            val framed = GoldenCircleCopy.frame(msg.toDto())
            rows += WidgetRowItem(
                instanceId = msg.instanceId,
                title = "${msg.instanceName} · ${framed.whyHeadline}",
                meta = shortTime(msg.updatedAt, nowMs),
                tone = WidgetTone.CRITICAL,
            )
        }

        for (msg in unreadMessages) {
            if (rows.size >= 3) break
            if (!seenSeqs.add(msg.seq)) continue
            val rowTone = if (MessageCategoryHelper.isFail(msg.kind)) WidgetTone.CRITICAL else WidgetTone.UNREAD
            val framed = GoldenCircleCopy.frame(msg.toDto())
            rows += WidgetRowItem(
                instanceId = msg.instanceId,
                title = "${msg.instanceName} · ${framed.whyHeadline}",
                meta = "NEU · ${shortTime(msg.updatedAt, nowMs)}",
                tone = rowTone,
            )
        }

        if (rows.size < 3) {
            for (ch in channels) {
                if (rows.size >= 3) break
                if (rows.any { it.instanceId == ch.instanceId && (ch.openAlerts > 0 || ch.unreadCount > 0) }) continue
                val chTone = when {
                    ch.openAlerts > 0 || ch.lastSyncOk == false -> WidgetTone.CRITICAL
                    ch.unreadCount > 0 -> WidgetTone.UNREAD
                    else -> WidgetTone.CALM
                }
                val summary = ch.lastMessageTitle ?: "Ruhig – keine Vorfälle"
                val meta = when {
                    ch.unreadCount > 0 -> "${ch.unreadCount} neu"
                    ch.lastMessageAt != null -> shortTime(ch.lastMessageAt, nowMs)
                    else -> "OK"
                }
                rows += WidgetRowItem(
                    instanceId = ch.instanceId,
                    title = "${ch.name} · $summary",
                    meta = meta,
                    tone = chTone,
                )
            }
        }

        if (rows.isEmpty() && recentMessages.isNotEmpty()) {
            for (msg in recentMessages.take(3)) {
                rows += WidgetRowItem(
                    instanceId = msg.instanceId,
                    title = "${msg.instanceName} · ${msg.title}",
                    meta = shortTime(msg.updatedAt, nowMs),
                    tone = WidgetTone.CALM,
                )
            }
        }

        return WidgetSnapshotModel(
            tone = tone,
            headline = headline,
            subtitle = subtitle,
            compactTitle = compactTitle,
            compactSubtitle = compactSub,
            connectionBadge = connBadge,
            openTabTarget = openTab,
            openButtonLabel = openLabel,
            showMarkAllRead = totalUnread > 0,
            rows = rows.take(3),
        )
    }

    private fun shortTime(ts: Long, nowMs: Long): String {
        val diff = (nowMs - ts).coerceAtLeast(0L)
        return when {
            diff < 60_000L -> "gerade"
            diff < 3_600_000L -> "${diff / 60_000L}m"
            diff < 86_400_000L -> SimpleDateFormat("HH:mm", Locale.GERMANY).format(Date(ts))
            else -> SimpleDateFormat("dd.MM.", Locale.GERMANY).format(Date(ts))
        }
    }
}
