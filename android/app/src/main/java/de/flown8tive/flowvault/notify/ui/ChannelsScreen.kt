package de.flown8tive.flowvault.notify.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
    FAILS("Fails"),
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
    val channels by vm.channels.collectAsState()
    val openAlerts by vm.openAlerts.collectAsState()
    val connState by vm.connectionState.collectAsState()
    var filter by remember { mutableStateOf(ChannelFilter.ALL) }
    var searchOpen by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var contextChannel by remember { mutableStateOf<ChannelEntity?>(null) }

    val searchResults by remember(searchQuery) {
        vm.searchMessages(searchQuery.trim())
    }.collectAsState(initial = emptyList())

    val filtered = remember(channels, filter) {
        channels.filter { ch ->
            when (filter) {
                ChannelFilter.ALL -> true
                ChannelFilter.UNREAD -> ch.unreadCount > 0
                ChannelFilter.FAILS -> ch.openAlerts > 0 || (ch.lastMessageKind != null && MessageCategoryHelper.isFail(ch.lastMessageKind))
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
                                ConnectionState.LIVE -> "Live verbunden"
                                ConnectionState.SYNCED -> "Synchronisiert"
                                ConnectionState.CONNECTING -> "Verbinde…"
                                ConnectionState.OFFLINE -> "Offline-Cache"
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
                        Icon(Icons.Default.Settings, contentDescription = "Einstellungen", tint = FvColors.Muted)
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
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(ChannelFilter.entries) { item ->
                        FilterChip(
                            selected = filter == item,
                            onClick = { filter = item },
                            label = { Text(item.label) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = FvColors.AccentStrong,
                                selectedLabelColor = FvColors.Text,
                            ),
                        )
                    }
                }

                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    if (openAlerts.isNotEmpty()) {
                        item(key = "pinned-alerts") {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 6.dp)
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(FvColors.Del.copy(alpha = 0.16f))
                                    .combinedClickable(onClick = onOpenAlerts)
                                    .padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Icon(Icons.Default.Warning, contentDescription = null, tint = FvColors.Del)
                                Column(Modifier.weight(1f)) {
                                    Text("Offene kritische Warnungen", fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                                    Text(
                                        "${openAlerts.size} aktive Fehlerquoten-Regression${if (openAlerts.size == 1) "" else "en"}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = FvColors.Muted,
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .clip(CircleShape)
                                        .background(FvColors.Del)
                                        .padding(horizontal = 10.dp, vertical = 4.dp),
                                ) {
                                    Text("${openAlerts.size}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = FvColors.Text)
                                }
                            }
                        }
                    }

                    if (filtered.isEmpty()) {
                        item(key = "empty") {
                            Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                                Text("Keine Instanz-Kanäle in dieser Ansicht.", color = FvColors.Dim)
                            }
                        }
                    }

                    items(filtered, key = { it.instanceId }) { ch ->
                        ChannelRow(
                            channel = ch,
                            onClick = { onOpenChannel(ch.instanceId, ch.name) },
                            onLongClick = { contextChannel = ch },
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
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(ch.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                TextButton(onClick = { vm.markChannelRead(ch.instanceId); contextChannel = null }) {
                    Text("Als gelesen markieren", color = FvColors.Text)
                }
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChannelRow(
    channel: ChannelEntity,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val avatarColor = parseHexColor(channel.color)
    val muted = channel.mutedUntil != null && (channel.mutedUntil == -1L || channel.mutedUntil > System.currentTimeMillis())
    val initials = channel.name.trim().split(" ").take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "FV" }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
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
                    fontWeight = FontWeight.SemiBold,
                    color = FvColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                channel.lastMessageAt?.let { ts ->
                    Text(formatRelativeTime(ts), style = MaterialTheme.typography.labelSmall, color = FvColors.Dim)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val preview = when {
                    channel.lastMessageTitle != null -> {
                        val badge = channel.lastMessageKind?.let { "[${MessageCategoryHelper.badgeLabel(it)}] " } ?: ""
                        "$badge${channel.lastMessageTitle}"
                    }
                    else -> "Noch keine Meldungen"
                }
                Text(
                    preview,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = FvColors.Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (muted) {
                    Icon(Icons.Default.NotificationsOff, contentDescription = "Stumm", tint = FvColors.Dim, modifier = Modifier.size(14.dp))
                }
                if (channel.unreadCount > 0) {
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
