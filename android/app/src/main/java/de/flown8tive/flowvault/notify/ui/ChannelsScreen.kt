package de.flown8tive.flowvault.notify.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BatteryAlert
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.MarkChatRead
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.flown8tive.flowvault.notify.data.ChannelEntity
import de.flown8tive.flowvault.notify.data.ConnectionState
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import de.flown8tive.flowvault.notify.ui.theme.parseHexColor
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class ChannelFilter(val label: String) {
    ALL("Alle"),
    UNREAD("Ungelesen"),
    FAILS("Störungen"),
    CHANGES("Änderungen"),
}

/**
 * Einhand-Startansicht (Thumb-Zone First + Golden Circle):
 * - Oberes Drittel: Ruhiger Sichtbereich (WHY System-Puls) ohne schwer erreichbare Menüs.
 *   Drückt die erste Instanz-Kachel ergonomisch in die Daumen-Zone (One-UI-Prinzip).
 * - Mitte/Unten: Instanz-Liste mit Pull-to-Refresh & beidseitiger Wischgeste (Links ODER Rechts).
 * - Ganz unten: Filter-Chips, „Alle gelesen“ & Sync direkt über der unteren Daumen-Navigation.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChannelsScreen(
    vm: AppViewModel,
    onOpenChannel: (Int, String) -> Unit,
    onOpenFocus: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val channels by vm.channels.collectAsState()
    val openAlerts by vm.openAlerts.collectAsState()
    val connState by vm.connectionState.collectAsState()
    val busy by vm.busy.collectAsState()

    var permStatus by remember { mutableStateOf(PermissionHelper.check(context)) }
    var filter by remember { mutableStateOf(ChannelFilter.ALL) }
    var contextChannel by remember { mutableStateOf<ChannelEntity?>(null) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permStatus = PermissionHelper.check(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val totalUnread = remember(channels) { channels.sumOf { it.unreadCount } }

    val filtered = remember(channels, filter) {
        channels.filter { ch ->
            when (filter) {
                ChannelFilter.ALL -> true
                ChannelFilter.UNREAD -> ch.unreadCount > 0
                ChannelFilter.FAILS -> ch.openAlerts > 0 || ch.lastSyncOk == false || (ch.lastMessageKind != null && MessageCategoryHelper.isFail(ch.lastMessageKind))
                ChannelFilter.CHANGES -> ch.lastMessageKind != null && MessageCategoryHelper.isChange(ch.lastMessageKind)
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(FvColors.Bg)) {
        PullToRefreshBox(
            isRefreshing = busy,
            onRefresh = { vm.refresh() },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 12.dp),
            ) {
                // ─── 1. GOLDEN CIRCLE WHY: Oberer Sichtbereich (schiebt Liste in Daumen-Reichweite) ───
                item(key = "one-ui-why-header") {
                    ReachabilityPulseHeader(
                        connState = connState,
                        openAlertsCount = openAlerts.size,
                        totalUnread = totalUnread,
                        channelsCount = channels.size,
                        onOpenFocus = onOpenFocus,
                    )
                }

                if (!permStatus.allOptimal) {
                    item(key = "permission-nudge") {
                        PermissionNudgeBanner(
                            status = permStatus,
                            onFixBattery = { PermissionHelper.requestIgnoreBatteryOptimizations(context) },
                            onFixNotifications = { PermissionHelper.openNotificationSettings(context) },
                        )
                    }
                }

                // ─── 2. WHAT: Überwachte Instanz-Kanäle in bequemer Daumenhöhe ───
                if (filtered.isEmpty()) {
                    item(key = "empty") {
                        Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                            Text(
                                if (filter == ChannelFilter.UNREAD) "Alles gelesen – keine offenen Meldungen." else "Keine Instanz-Kanäle in dieser Ansicht.",
                                color = FvColors.Dim,
                            )
                        }
                    }
                } else {
                    item(key = "gesture-hint") {
                        Text(
                            "Links oder rechts wischen = Gelesen/Ungelesen · Gedrückt halten = Optionen",
                            style = MaterialTheme.typography.labelSmall,
                            color = FvColors.Dim,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                        )
                    }
                }

                items(filtered, key = { it.instanceId }) { ch ->
                    SwipeableChannelRow(
                        channel = ch,
                        onClick = { onOpenChannel(ch.instanceId, ch.name) },
                        onLongClick = { contextChannel = ch },
                        onToggleRead = {
                            if (ch.unreadCount > 0) vm.markChannelRead(ch.instanceId)
                            else vm.markChannelUnread(ch.instanceId)
                        },
                    )
                    HorizontalDivider(color = FvColors.Line, modifier = Modifier.padding(start = 76.dp))
                }
            }
        }

        // ─── 3. HOW: Untere Daumen-Steuerleiste (Filter, Alle gelesen, Sync) ───
        HorizontalDivider(color = FvColors.Line2)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(FvColors.Panel)
                .padding(start = 12.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LazyRow(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(end = 6.dp),
            ) {
                items(ChannelFilter.entries) { item ->
                    val chipLabel = if (item == ChannelFilter.UNREAD && totalUnread > 0) {
                        "Ungelesen ($totalUnread)"
                    } else {
                        item.label
                    }
                    FilterChip(
                        selected = filter == item,
                        onClick = { filter = item },
                        label = { Text(chipLabel, style = MaterialTheme.typography.labelMedium) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = FvColors.AccentStrong,
                            selectedLabelColor = FvColors.Text,
                        ),
                    )
                }
            }

            if (totalUnread > 0) {
                IconButton(onClick = { vm.markAllRead() }) {
                    Icon(Icons.Default.DoneAll, contentDescription = "Alle als gelesen markieren", tint = FvColors.Add)
                }
            }
            IconButton(onClick = { vm.refresh() }) {
                Icon(Icons.Default.Refresh, contentDescription = "Jetzt synchronisieren", tint = FvColors.Muted)
            }
        }
    }

    contextChannel?.let { ch ->
        val isMuted = ch.mutedUntil != null && (ch.mutedUntil == -1L || ch.mutedUntil > System.currentTimeMillis())
        ModalBottomSheet(
            onDismissRequest = { contextChannel = null },
            containerColor = FvColors.Panel,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(ch.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                Text(
                    if (ch.unreadCount > 0) "${ch.unreadCount} ungelesene Meldung(en)" else "Alle Meldungen gelesen",
                    style = MaterialTheme.typography.bodySmall,
                    color = FvColors.Muted,
                )
                Spacer(Modifier.height(4.dp))
                if (ch.unreadCount > 0) {
                    Button(
                        onClick = { vm.markChannelRead(ch.instanceId); contextChannel = null },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                    ) {
                        Icon(Icons.Default.MarkChatRead, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Kanal als gelesen markieren")
                    }
                } else {
                    OutlinedButton(
                        onClick = { vm.markChannelUnread(ch.instanceId); contextChannel = null },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.MarkChatUnread, contentDescription = null, tint = FvColors.AccentHi, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Als ungelesen markieren (Wiedervorlage)", color = FvColors.AccentHi)
                    }
                }
                HorizontalDivider(color = FvColors.Line, modifier = Modifier.padding(vertical = 4.dp))
                if (isMuted) {
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, null); contextChannel = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("Stummschaltung aufheben", color = FvColors.Add)
                    }
                } else {
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, 3_600_000L); contextChannel = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("1 Stunde stummschalten", color = FvColors.Text)
                    }
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, 8 * 3_600_000L); contextChannel = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("8 Stunden stummschalten", color = FvColors.Text)
                    }
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, -1L); contextChannel = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("Dauerhaft stummschalten", color = FvColors.Del)
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun ReachabilityPulseHeader(
    connState: ConnectionState,
    openAlertsCount: Int,
    totalUnread: Int,
    channelsCount: Int,
    onOpenFocus: () -> Unit,
) {
    val connDot = when (connState) {
        ConnectionState.LIVE -> FvColors.Add
        ConnectionState.SYNCED -> FvColors.Info
        ConnectionState.CONNECTING -> FvColors.Mod
        ConnectionState.OFFLINE -> FvColors.Dim
    }
    val connLabel = when (connState) {
        ConnectionState.LIVE -> "FlowVault · Echtzeit-Schutz aktiv"
        ConnectionState.SYNCED -> "FlowVault · Synchronisiert"
        ConnectionState.CONNECTING -> "FlowVault · Verbinde…"
        ConnectionState.OFFLINE -> "FlowVault · Offline (Auto-Reconnect)"
    }

    val cardBg: Color
    val cardBorder: Color
    val statusColor: Color
    val headline: String
    val subtitle: String

    when {
        openAlertsCount > 0 -> {
            cardBg = FvColors.Del.copy(alpha = 0.14f)
            cardBorder = FvColors.Del.copy(alpha = 0.45f)
            statusColor = FvColors.Del
            headline = "$openAlertsCount kritische Störung${if (openAlertsCount == 1) "" else "en"}"
            subtitle = "Mindestens ein Workflow verliert Ausführungen. Öffne unten „Fokus“ für Diagnose & Rollback."
        }
        totalUnread > 0 -> {
            cardBg = FvColors.Accent.copy(alpha = 0.14f)
            cardBorder = FvColors.Accent.copy(alpha = 0.40f)
            statusColor = FvColors.AccentHi
            headline = "$totalUnread ungelesene Meldung${if (totalUnread == 1) "" else "en"}"
            subtitle = "Keine kritische Regression offen – neue Ereignisse stehen bereit."
        }
        else -> {
            cardBg = FvColors.Add.copy(alpha = 0.10f)
            cardBorder = FvColors.Add.copy(alpha = 0.28f)
            statusColor = FvColors.Add
            headline = "Alle Systeme laufen ruhig"
            subtitle = "$channelsCount überwachte Instanz${if (channelsCount == 1) "" else "en"} · keine offenen Störungen."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 196.dp)
            .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.Bottom,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(connDot))
            Text(connLabel, style = MaterialTheme.typography.labelMedium, color = FvColors.Muted)
        }
        Spacer(Modifier.height(10.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(cardBg)
                .border(1.dp, cardBorder, RoundedCornerShape(18.dp))
                .clickable { if (openAlertsCount > 0 || totalUnread > 0) onOpenFocus() }
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(
                    if (openAlertsCount > 0) Icons.Default.Warning else Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = statusColor,
                    modifier = Modifier.size(24.dp),
                )
                Text(headline, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = FvColors.Text)
            }
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
        }
    }
}

@Composable
internal fun PermissionNudgeBanner(
    status: RealtimePermissionStatus,
    onFixBattery: () -> Unit,
    onFixNotifications: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(FvColors.Mod.copy(alpha = 0.14f))
            .border(1.dp, FvColors.Mod.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Default.BatteryAlert, contentDescription = null, tint = FvColors.Mod, modifier = Modifier.size(18.dp))
            Text("Echtzeit-Freigabe noch offen", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
        }
        Text(
            if (!status.batteryUnrestricted) {
                "Erlaube Akku „Nicht eingeschränkt“, damit Android den Live-Stream im Standby nicht pausiert."
            } else {
                "Erlaube System-Benachrichtigungen, damit kritische Ausfälle sofort gemeldet werden."
            },
            style = MaterialTheme.typography.bodySmall,
            color = FvColors.Muted,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!status.batteryUnrestricted) {
                Button(
                    onClick = onFixBattery,
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Text("Akku freigeben", style = MaterialTheme.typography.labelMedium)
                }
            }
            if (!status.notificationsGranted) {
                OutlinedButton(
                    onClick = onFixNotifications,
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Text("Meldungen erlauben", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeableChannelRow(
    channel: ChannelEntity,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onToggleRead: () -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.StartToEnd || value == SwipeToDismissBoxValue.EndToStart) {
                onToggleRead()
            }
            false // Beidseitiger Daumen-Swipe für Rechts- & Linkshänder, federt sauber zurück
        },
    )

    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = true,
        enableDismissFromEndToStart = true,
        backgroundContent = {
            val alignEnd = dismissState.dismissDirection == SwipeToDismissBoxValue.EndToStart
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .background(if (channel.unreadCount > 0) FvColors.Add.copy(alpha = 0.25f) else FvColors.Accent.copy(alpha = 0.25f))
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (alignEnd) Arrangement.End else Arrangement.Start,
            ) {
                Icon(
                    if (channel.unreadCount > 0) Icons.Default.MarkChatRead else Icons.Default.MarkChatUnread,
                    contentDescription = null,
                    tint = if (channel.unreadCount > 0) FvColors.Add else FvColors.AccentHi,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    if (channel.unreadCount > 0) "Als gelesen" else "Als ungelesen",
                    fontWeight = FontWeight.SemiBold,
                    color = FvColors.Text,
                )
            }
        },
        content = {
            Box(Modifier.background(FvColors.Bg)) {
                ChannelRow(channel = channel, onClick = onClick, onLongClick = onLongClick)
            }
        },
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChannelRow(
    channel: ChannelEntity,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val avatarColor = parseHexColor(channel.color)
    val muted = channel.mutedUntil != null && (channel.mutedUntil == -1L || channel.mutedUntil > System.currentTimeMillis())
    val hasUnread = channel.unreadCount > 0
    val initials = channel.name.trim().split(" ").take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "FV" }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                modifier = Modifier
                    .size(50.dp)
                    .clip(CircleShape)
                    .background(avatarColor.copy(alpha = 0.22f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(initials, color = avatarColor, fontWeight = FontWeight.Bold)
            }
            val statusColor = when {
                channel.openAlerts > 0 || channel.lastSyncOk == false -> FvColors.Del
                channel.lastSyncOk == true -> FvColors.Add
                else -> FvColors.Dim
            }
            Box(
                modifier = Modifier
                    .size(13.dp)
                    .clip(CircleShape)
                    .background(FvColors.Bg)
                    .padding(2.dp)
                    .clip(CircleShape)
                    .background(statusColor),
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    channel.name,
                    modifier = Modifier.weight(1f),
                    fontWeight = if (hasUnread) FontWeight.Bold else FontWeight.SemiBold,
                    color = FvColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                channel.lastMessageAt?.let { ts ->
                    Text(
                        formatRelativeTime(ts),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (hasUnread) FvColors.AccentHi else FvColors.Dim,
                        fontWeight = if (hasUnread) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val preview = when {
                    channel.openAlerts > 0 -> "Kritische Störung offen (${channel.openAlerts})"
                    channel.lastMessageTitle != null -> channel.lastMessageTitle
                    else -> "Ruhig – noch keine Meldungen"
                }
                Text(
                    preview,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (hasUnread) FvColors.Text else FvColors.Muted,
                    fontWeight = if (hasUnread) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (muted) {
                    Icon(Icons.Default.NotificationsOff, contentDescription = "Stumm", tint = FvColors.Dim, modifier = Modifier.size(14.dp))
                }
                if (hasUnread) {
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(FvColors.Accent)
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    ) {
                        Text(
                            if (channel.unreadCount > 99) "99+" else "${channel.unreadCount}",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = FvColors.Text,
                        )
                    }
                }
            }
        }
    }
}

fun formatRelativeTime(timestampMs: Long, nowMs: Long = System.currentTimeMillis()): String {
    val diff = (nowMs - timestampMs).coerceAtLeast(0)
    return when {
        diff < 60_000 -> "gerade"
        diff < 3_600_000 -> "vor ${diff / 60_000} Min."
        diff < 86_400_000 -> SimpleDateFormat("HH:mm", Locale.GERMANY).format(Date(timestampMs))
        else -> SimpleDateFormat("dd.MM.", Locale.GERMANY).format(Date(timestampMs))
    }
}
