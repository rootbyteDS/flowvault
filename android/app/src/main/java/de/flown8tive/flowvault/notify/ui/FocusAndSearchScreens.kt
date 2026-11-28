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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.flown8tive.flowvault.notify.data.MessageEntity
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.ui.theme.FvColors

private enum class FocusFilter(val label: String) {
    ALL("Offen & Neu"),
    CRITICAL("Kritisch"),
    UNREAD("Ungelesen"),
}

/**
 * Einhand-Fokus-Posteingang (Tab 2):
 * Bündelt alle offenen kritischen Störungen & ungelesenen Meldungen über alle Instanzen hinweg.
 * Neueste/wichtigste Karte liegt dank `reverseLayout = true` direkt unten über dem Daumen!
 */
@Composable
fun FocusScreen(
    vm: AppViewModel,
    onOpenChannel: (Int, String) -> Unit,
) {
    val context = LocalContext.current
    val channels by vm.channels.collectAsState()
    val openAlerts by vm.openAlerts.collectAsState()
    val unreadMessages by vm.unreadMessages.collectAsState()
    val allowRollback by vm.allowRollback.collectAsState()
    val analyzingSeqs by vm.analyzingSeqs.collectAsState()
    val rollbackBusy by vm.rollbackBusy.collectAsState()
    val urlByInst = remember(channels) { channels.associate { it.instanceId to it.instanceUrl } }

    var filter by remember { mutableStateOf(FocusFilter.ALL) }
    var selectedDetail by remember { mutableStateOf<UiChatMessage?>(null) }

    val combined = remember(openAlerts, unreadMessages, filter) {
        val raw = when (filter) {
            FocusFilter.CRITICAL -> openAlerts
            FocusFilter.UNREAD -> unreadMessages
            FocusFilter.ALL -> {
                val map = LinkedHashMap<Long, MessageEntity>()
                openAlerts.forEach { map[it.seq] = it }
                unreadMessages.forEach { map.putIfAbsent(it.seq, it) }
                map.values.sortedByDescending { it.updatedAt }
            }
        }
        raw.map { UiChatMessage(it.toDto(), it.unread, it.decodedDiagnosis()) }
    }

    Column(modifier = Modifier.fillMaxSize().background(FvColors.Bg)) {
        // Ruhiger Sicht-Header oben
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(FvColors.Sidebar)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("Fokus-Posteingang", fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                Text(
                    "${openAlerts.size} kritisch · ${unreadMessages.size} ungelesen",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (openAlerts.isNotEmpty()) FvColors.Del else FvColors.Muted,
                )
            }
        }
        HorizontalDivider(color = FvColors.Line)

        if (combined.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = FvColors.Add, modifier = Modifier.size(38.dp))
                    Text("Alles erledigt – Kopf frei", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                    Text("Keine offenen kritischen Störungen oder ungelesenen Meldungen.", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                }
            }
        } else {
            // reverseLayout = true -> Index 0 (wichtigste/neueste Meldung) liegt direkt unten am Daumen!
            LazyColumn(
                reverseLayout = true,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(combined, key = { it.dto.seq }) { item ->
                    val msg = item.dto
                    val rollbackVerId = msg.metadata.rollback?.versionId ?: item.diagnosis?.rollbackVersionId
                    val rollbackVerNum = msg.metadata.rollback?.number ?: item.diagnosis?.rollbackVersionNumber
                    SwipeableMessageCard(
                        msg = msg,
                        unread = item.unread,
                        diagnosis = item.diagnosis,
                        isAnalyzing = analyzingSeqs.contains(msg.seq),
                        allowRollback = allowRollback,
                        rollbackBusy = rollbackBusy,
                        rollbackVersionNumber = rollbackVerNum,
                        channelInstanceUrl = urlByInst[msg.instance.id],
                        showInstance = true,
                        onOpenSheet = { selectedDetail = item },
                        onToggleUnread = { vm.setMessageUnread(msg.seq, msg.instance.id, !item.unread) },
                        onAnalyze = { vm.analyzeMessage(msg.seq) },
                        onRollback = {
                            val wfId = msg.workflow?.id
                            if (!allowRollback) {
                                vm.showBanner("Rollback in FlowVault Web unter „Einstellungen → Mobile App“ freischalten.")
                            } else if (wfId != null && rollbackVerId != null) {
                                vm.requestRollback(wfId, rollbackVerId)
                            }
                        },
                        onOpenWeb = { openInWeb(context, vm.prefs.serverUrl, msg.metadata.webPath) },
                        onDismissAlert = { msg.alertId?.let { vm.dismissAlert(it) } },
                        onMuteWorkflow = { msg.workflow?.id?.let { vm.muteWorkflow(it, 3_600_000L) } },
                    )
                }
            }
        }

        // Untere Einhand-Steuerleiste direkt über der Bottom-Navigation
        HorizontalDivider(color = FvColors.Line2)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(FvColors.Panel)
                .padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            LazyRow(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(FocusFilter.entries) { item ->
                    val label = when (item) {
                        FocusFilter.ALL -> "Alle"
                        FocusFilter.CRITICAL -> "Kritisch (${openAlerts.size})"
                        FocusFilter.UNREAD -> "Ungelesen (${unreadMessages.size})"
                    }
                    FilterChip(
                        selected = filter == item,
                        onClick = { filter = item },
                        label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = FvColors.AccentStrong,
                            selectedLabelColor = FvColors.Text,
                        ),
                    )
                }
            }

            if (unreadMessages.isNotEmpty()) {
                Button(
                    onClick = { vm.markAllRead() },
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Icon(Icons.Default.DoneAll, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Alle gelesen", style = MaterialTheme.typography.labelMedium)
                }
            }
            IconButton(onClick = { vm.refresh() }) {
                Icon(Icons.Default.Refresh, contentDescription = "Synchronisieren", tint = FvColors.Muted)
            }
        }
    }

    selectedDetail?.let { item ->
        val liveItem = combined.firstOrNull { it.dto.seq == item.dto.seq } ?: item
        MessageDetailBottomSheet(
            item = liveItem,
            channelInstanceUrl = urlByInst[liveItem.dto.instance.id],
            analyzingSeqs = analyzingSeqs,
            allowRollback = allowRollback,
            serverUrl = vm.prefs.serverUrl,
            onDismiss = { selectedDetail = null },
            onToggleUnread = {
                vm.setMessageUnread(liveItem.dto.seq, liveItem.dto.instance.id, !liveItem.unread)
                if (liveItem.unread) selectedDetail = null
            },
            onAnalyze = { vm.analyzeMessage(liveItem.dto.seq) },
            onRequestRollback = { wfId, verId ->
                selectedDetail = null
                vm.requestRollback(wfId, verId)
            },
        )
    }
}

/**
 * Einhand-Suche (Tab 3):
 * Suchleiste und Schnell-Filter sitzen unten direkt über Tastatur / Daumen (wie moderne Browser).
 * Treffer stapeln sich von unten nach oben entgegen.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SearchScreen(
    vm: AppViewModel,
    onOpenChannel: (Int, String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val results by remember(query) {
        vm.searchMessages(query.trim())
    }.collectAsState(initial = emptyList())

    val quickTags = listOf("Fehler", "Timeout", "401", "500", "Sync", "v")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(FvColors.Bg)
            .imePadding(),
    ) {
        if (results.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    if (query.isBlank()) "Tippe unten einen Suchbegriff oder Schnell-Filter an." else "Keine Treffer für „$query“.",
                    color = FvColors.Dim,
                )
            }
        } else {
            LazyColumn(
                reverseLayout = true,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(results, key = { it.seq }) { msg ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(FvColors.Panel)
                            .border(1.dp, if (msg.unread) FvColors.Accent.copy(alpha = 0.45f) else FvColors.Line, RoundedCornerShape(12.dp))
                            .combinedClickable(
                                onClick = { onOpenChannel(msg.instanceId, msg.instanceName) },
                                onLongClick = { vm.setMessageUnread(msg.seq, msg.instanceId, !msg.unread) },
                            )
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (msg.unread) {
                                Box(Modifier.size(7.dp).clip(CircleShape).background(FvColors.Accent))
                            }
                            Text(msg.instanceName, style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                            Text("·", color = FvColors.Dim)
                            Text(MessageCategoryHelper.badgeLabel(msg.kind), style = MaterialTheme.typography.labelSmall, color = FvColors.Muted)
                            Spacer(Modifier.weight(1f))
                            Text(formatRelativeTime(msg.updatedAt), style = MaterialTheme.typography.labelSmall, color = FvColors.Dim)
                        }
                        Text(msg.title, fontWeight = FontWeight.SemiBold, color = FvColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(msg.body, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }

        // Untere Daumen-Suchleiste
        HorizontalDivider(color = FvColors.Line2)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(FvColors.Panel)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(quickTags) { tag ->
                    AssistChip(
                        onClick = { query = tag },
                        label = { Text(tag, style = MaterialTheme.typography.labelSmall) },
                    )
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Workflow, Node oder Fehlermeldung…") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = FvColors.AccentHi) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { query = "" }) {
                            Icon(Icons.Default.Clear, contentDescription = "Löschen", tint = FvColors.Muted)
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
