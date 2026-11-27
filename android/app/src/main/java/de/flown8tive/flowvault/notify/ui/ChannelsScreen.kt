package de.flown8tive.flowvault.notify.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.filled.MarkChatRead
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import de.flown8tive.flowvault.notify.data.MessageEntity
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChannelsScreen(
    vm: AppViewModel,
    onOpenChannel: (Int, String) -> Unit,
    onOpenAlerts: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val channels by vm.channels.collectAsState()
    val openAlerts by vm.openAlerts.collectAsState()
    val connState by vm.connectionState.collectAsState()

    var permStatus by remember { mutableStateOf(PermissionHelper.check(context)) }
    var filter by remember { mutableStateOf(ChannelFilter.ALL) }
    var searchOpen by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var contextChannel by remember { mutableStateOf<ChannelEntity?>(null) }

    // Aktualisiert Freigaben sofort, wenn man aus den Android-Systemeinstellungen zurückkehrt
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

    val searchResults by remember(searchQuery) {
        vm.searchMessages(searchQuery.trim())
    }.collectAsState(initial = emptyList())

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

    Scaffold(
        containerColor = FvColors.Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = FvColors.Sidebar),
                title = {
                    Column {
                        Text("FlowVault", fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val dot = when (connState) {
                                ConnectionState.LIVE -> FvColors.Add
                                ConnectionState.SYNCED -> FvColors.Info
                                ConnectionState.CONNECTING -> FvColors.Mod
                                ConnectionState.OFFLINE -> FvColors.Dim
                            }
                            val label = when (connState) {
                                ConnectionState.LIVE -> "Echtzeit-Schutz aktiv"
                                ConnectionState.SYNCED -> "Synchronisiert"
                                ConnectionState.CONNECTING -> "Verbinde…"
                                ConnectionState.OFFLINE -> "Offline – verbinde automatisch"
                            }
                            Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
                            Text(label, style = MaterialTheme.typography.labelSmall, color = FvColors.Muted)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { searchOpen = !searchOpen; if (!searchOpen) searchQuery = "" }) {
                        Icon(Icons.Default.Search, contentDescription = "Suchen", tint = FvColors.Muted)
                    }
                    IconButton(onClick = { vm.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Aktualisieren", tint = FvColors.Muted)
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Einstellungen & Freigaben", tint = if (permStatus.allOptimal) FvColors.Muted else FvColors.Mod)
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (searchOpen) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Workflows, Nodes oder Fehler suchen…") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            if (searchQuery.isNotBlank()) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(searchResults, key = { it.seq }) { msg ->
                        SearchResultRow(msg) { onOpenChannel(msg.instanceId, msg.instanceName) }
                    }
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    // ─── 1. GOLDEN CIRCLE: WHY (Systemzustand & Sinn auf den ersten Blick) ───
                    item(key = "golden-why-hero") {
                        SystemPulseHero(
                            openAlertsCount = openAlerts.size,
                            totalUnread = totalUnread,
                            channelsCount = channels.size,
                            onOpenAlerts = onOpenAlerts,
                            onFilterUnread = { filter = ChannelFilter.UNREAD },
                        )
                    }

                    // Warn-Kachel, falls eine Android-Systemfreigabe den Echtzeit-Schutz ausbremst
                    if (!permStatus.allOptimal) {
                        item(key = "permission-banner") {
                            PermissionNudgeBanner(
                                status = permStatus,
                                onFixBattery = { PermissionHelper.requestIgnoreBatteryOptimizations(context) },
                                onFixNotifications = { PermissionHelper.openNotificationSettings(context) },
                            )
                        }
                    }

                    // ─── 2. GOLDEN CIRCLE: HOW (Fokus wählen & schnell abarbeiten) ───
                    item(key = "golden-how-filters") {
                        Column {
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                                        label = { Text(chipLabel) },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = FvColors.AccentStrong,
                                            selectedLabelColor = FvColors.Text,
                                        ),
                                    )
                                }
                            }
                            if (filtered.isNotEmpty()) {
                                Text(
                                    "Tipp: Nach rechts wischen oder gedrückt halten, um Gelesen/Ungelesen umzuschalten",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = FvColors.Dim,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }

                    // ─── 3. GOLDEN CIRCLE: WHAT (Die einzelnen Instanz-Kanäle) ───
                    if (filtered.isEmpty()) {
                        item(key = "empty") {
                            Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    if (filter == ChannelFilter.UNREAD) "Alles erledigt – keine ungelesenen Meldungen." else "Keine Instanz-Kanäle in dieser Ansicht.",
                                    color = FvColors.Dim,
                                )
                            }
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
        }
    }

    contextChannel?.let { ch ->
        val isMuted = ch.mutedUntil != null && (ch.mutedUntil == -1L || ch.mutedUntil > System.currentTimeMillis())
        ModalBottomSheet(
            onDismissRequest = { contextChannel = null },
            containerColor = FvColors.Panel,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(ch.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                Text(
                    if (ch.unreadCount > 0) "${ch.unreadCount} ungelesene Meldung(en)" else "Alle Meldungen gelesen",
                    style = MaterialTheme.typography.bodySmall,
                    color = FvColors.Muted,
                )
                Spacer(Modifier.height(4.dp))
                if (ch.unreadCount > 0) {
                    TextButton(onClick = { vm.markChannelRead(ch.instanceId); contextChannel = null }) {
                        Icon(Icons.Default.MarkChatRead, contentDescription = null, tint = FvColors.Add, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Kanal als gelesen markieren", color = FvColors.Text)
                    }
                } else {
                    TextButton(onClick = { vm.markChannelUnread(ch.instanceId); contextChannel = null }) {
                        Icon(Icons.Default.MarkChatUnread, contentDescription = null, tint = FvColors.AccentHi, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Als ungelesen markieren (für später)", color = FvColors.AccentHi)
                    }
                }
                HorizontalDivider(color = FvColors.Line)
                if (isMuted) {
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, null); contextChannel = null }) {
                        Text("Stummschaltung aufheben", color = FvColors.Add)
                    }
                } else {
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, 3_600_000L); contextChannel = null }) {
                        Text("1 Stunde stummschalten", color = FvColors.Muted)
                    }
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, 8 * 3_600_000L); contextChannel = null }) {
                        Text("8 Stunden stummschalten", color = FvColors.Muted)
                    }
                    TextButton(onClick = { vm.muteInstance(ch.instanceId, -1L); contextChannel = null }) {
                        Text("Dauerhaft stummschalten", color = FvColors.Del)
                    }
                }
                Spacer(Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun SystemPulseHero(
    openAlertsCount: Int,
    totalUnread: Int,
    channelsCount: Int,
    onOpenAlerts: () -> Unit,
    onFilterUnread: () -> Unit,
) {
    val bgColor: Color
    val borderColor: Color
    val iconColor: Color
    val title: String
    val subtitle: String

    when {
        openAlertsCount > 0 -> {
            bgColor = FvColors.Del.copy(alpha = 0.14f)
            borderColor = FvColors.Del.copy(alpha = 0.45f)
            iconColor = FvColors.Del
            title = "Handlungsbedarf: $openAlertsCount kritische Störung${if (openAlertsCount == 1) "" else "en"}"
            subtitle = "Mindestens ein Workflow verliert aktiv Ausführungen – Ursache prüfen oder zurückspielen."
        }
        totalUnread > 0 -> {
            bgColor = FvColors.Accent.copy(alpha = 0.14f)
            borderColor = FvColors.Accent.copy(alpha = 0.4f)
            iconColor = FvColors.AccentHi
            title = "$totalUnread ungelesene Meldung${if (totalUnread == 1) "" else "en"}"
            subtitle = "Keine ungelösten kritischen Regressionen – neue Ereignisse warten auf Durchsicht."
        }
        else -> {
            bgColor = FvColors.Add.copy(alpha = 0.10f)
            borderColor = FvColors.Add.copy(alpha = 0.30f)
            iconColor = FvColors.Add
            title = "Alle Systeme laufen ruhig"
            subtitle = "$channelsCount überwachte Instanz${if (channelsCount == 1) "" else "en"} · keine offenen Störungen oder ungelesenen Alarme."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(bgColor)
            .border(1.dp, borderColor, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(
                if (openAlertsCount > 0) Icons.Default.Warning else Icons.Default.CheckCircle,
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(22.dp),
            )
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
        }
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
        if (openAlertsCount > 0) {
            Button(
                onClick = onOpenAlerts,
                colors = ButtonDefaults.buttonColors(containerColor = FvColors.Del),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
            ) {
                Text("Kritische Störungen jetzt klären")
            }
        } else if (totalUnread > 0) {
            OutlinedButton(
                onClick = onFilterUnread,
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
            ) {
                Text("Ungelesene Meldungen filtern", color = FvColors.AccentHi)
            }
        }
    }
}

@Composable
private fun PermissionNudgeBanner(
    status: RealtimePermissionStatus,
    onFixBattery: () -> Unit,
    onFixNotifications: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(FvColors.Mod.copy(alpha = 0.14f))
            .border(1.dp, FvColors.Mod.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Default.BatteryAlert, contentDescription = null, tint = FvColors.Mod, modifier = Modifier.size(18.dp))
            Text("Echtzeit-Zuverlässigkeit verbessern", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
        }
        Text(
            if (!status.batteryUnrestricted) {
                "Android drosselt Hintergrundverbindungen im Standby. Erlaube „Nicht eingeschränkt“, damit Alarme ohne Verzögerung ankommen."
            } else {
                "System-Benachrichtigungen sind noch deaktiviert – erlaube sie, damit Störungen hör- und sichtbar gemeldet werden."
            },
            style = MaterialTheme.typography.bodySmall,
            color = FvColors.Muted,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!status.batteryUnrestricted) {
                Button(
                    onClick = onFixBattery,
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    Text("Akku-Freigabe erteilen", style = MaterialTheme.typography.labelMedium)
                }
            }
            if (!status.notificationsGranted) {
                OutlinedButton(
                    onClick = onFixNotifications,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    Text("Benachrichtigungen erlauben", style = MaterialTheme.typography.labelMedium)
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
            if (value == SwipeToDismissBoxValue.StartToEnd) {
                onToggleRead()
            }
            false // Nicht löschen, sondern als Messenger-Schnellaktion zurückfedern
        },
    )

    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = true,
        enableDismissFromEndToStart = false,
        backgroundContent = {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .background(if (channel.unreadCount > 0) FvColors.Add.copy(alpha = 0.25f) else FvColors.Accent.copy(alpha = 0.25f))
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    if (channel.unreadCount > 0) Icons.Default.MarkChatRead else Icons.Default.MarkChatUnread,
                    contentDescription = null,
                    tint = if (channel.unreadCount > 0) FvColors.Add else FvColors.AccentHi,
                )
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
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                modifier = Modifier
                    .size(48.dp)
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
                    .size(12.dp)
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
                            .padding(horizontal = 7.dp, vertical = 2.dp),
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SearchResultRow(msg: MessageEntity, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(FvColors.Panel)
            .combinedClickable(onClick = onClick)
            .padding(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(msg.instanceName, style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
            Text("·", color = FvColors.Dim)
            Text(MessageCategoryHelper.badgeLabel(msg.kind), style = MaterialTheme.typography.labelSmall, color = FvColors.Muted)
            if (msg.unread) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(FvColors.Accent))
            }
        }
        Text(msg.title, fontWeight = FontWeight.Medium, color = FvColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(msg.body, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
