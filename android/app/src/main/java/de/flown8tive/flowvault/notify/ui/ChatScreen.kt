package de.flown8tive.flowvault.notify.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MarkChatRead
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
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
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.flown8tive.flowvault.notify.data.MessageEntity
import de.flown8tive.flowvault.notify.model.DiagnosisDto
import de.flown8tive.flowvault.notify.model.GoldenCircleCopy
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.RollbackChallengeDto
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import de.flown8tive.flowvault.notify.ui.theme.parseHexColor
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class ChatFilter(val label: String) {
    ALL("Alle"),
    UNREAD("Ungelesen"),
    FAILS("Störungen"),
    CHANGES("Änderungen"),
}

internal data class UiChatMessage(
    val dto: MessageDto,
    val unread: Boolean,
    val diagnosis: DiagnosisDto?,
)

/**
 * Einhand-Kanalverlauf:
 * - Oben nur schlanker, passiver Status-Header (keine Buttons am oberen Bildschirmrand!).
 * - Neueste Nachricht liegt immer unten direkt über dem Daumen.
 * - Beidseitiger Daumen-Swipe auf jeder Nachricht für Gelesen/Ungelesen.
 * - Untere Daumen-Steuerleiste mit Filter-Chips, „← Zurück“, „✓✓ Alle gelesen“ und Kanal-Menü (`⋯`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    vm: AppViewModel,
    instanceId: Int?,
    title: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val rawMessages: List<MessageEntity> by remember(instanceId) {
        if (instanceId != null) vm.messagesForInstance(instanceId) else vm.openAlerts
    }.collectAsState(initial = emptyList())
    val channels by vm.channels.collectAsState()
    val channel = remember(channels, instanceId) { channels.firstOrNull { it.instanceId == instanceId } }

    val allowRollback by vm.allowRollback.collectAsState()
    val analyzingSeqs by vm.analyzingSeqs.collectAsState()
    val rollbackBusy by vm.rollbackBusy.collectAsState()

    var filter by remember { mutableStateOf(ChatFilter.ALL) }
    var selectedDetail by remember { mutableStateOf<UiChatMessage?>(null) }
    var channelMenuOpen by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    DisposableEffect(instanceId) {
        vm.setActiveInstance(instanceId)
        onDispose { vm.setActiveInstance(null) }
    }

    val unreadCountInChat = remember(rawMessages) { rawMessages.count { it.unread } }

    val messages = remember(rawMessages, filter) {
        rawMessages.map { UiChatMessage(it.toDto(), it.unread, it.decodedDiagnosis()) }.filter { m ->
            when (filter) {
                ChatFilter.ALL -> true
                ChatFilter.UNREAD -> m.unread
                ChatFilter.FAILS -> MessageCategoryHelper.isFail(m.dto.kind) || MessageCategoryHelper.isRecovery(m.dto.kind)
                ChatFilter.CHANGES -> MessageCategoryHelper.isChange(m.dto.kind)
            }
        }
    }

    LaunchedEffect(rawMessages.size, filter) {
        if (messages.isNotEmpty() && instanceId != null) {
            listState.scrollToItem(messages.lastIndex)
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(FvColors.Bg)) {
        // ─── Oberer passiver Info-Streifen (nur Lesen, kein Daumen-Strecken nötig) ───
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(FvColors.Sidebar)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val dotColor = channel?.color?.let { parseHexColor(it) } ?: FvColors.Accent
            Box(Modifier.size(10.dp).clip(CircleShape).background(dotColor))
            Text(
                title,
                fontWeight = FontWeight.SemiBold,
                color = FvColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (unreadCountInChat > 0) "$unreadCountInChat ungelesen" else "${rawMessages.size} Meldungen",
                style = MaterialTheme.typography.labelSmall,
                color = if (unreadCountInChat > 0) FvColors.AccentHi else FvColors.Muted,
            )
        }
        HorizontalDivider(color = FvColors.Line)

        // ─── Nachrichten-Stream (unten verankert für Einhand-Bedienung) ───
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (messages.isEmpty()) {
                Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text(
                        if (filter == ChatFilter.UNREAD) "Keine ungelesenen Meldungen in diesem Kanal." else "Noch keine Nachrichten in diesem Kanal.",
                        color = FvColors.Dim,
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Bottom),
                ) {
                    items(messages, key = { it.dto.seq }) { item ->
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
                            showInstance = instanceId == null,
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

                if (listState.canScrollForward && messages.isNotEmpty()) {
                    ExtendedFloatingActionButton(
                        onClick = { scope.launch { listState.animateScrollToItem(messages.lastIndex) } },
                        containerColor = FvColors.AccentStrong,
                        contentColor = FvColors.Text,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(14.dp),
                        icon = { Icon(Icons.Default.KeyboardArrowDown, contentDescription = null) },
                        text = { Text("Neueste") },
                    )
                }
            }
        }

        // ─── Untere Einhand-Steuerleiste (Filter + Zurück + Gelesen + Kanal-Optionen) ───
        HorizontalDivider(color = FvColors.Line2)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(FvColors.Sidebar)
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (instanceId != null) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(ChatFilter.entries) { item ->
                        val label = if (item == ChatFilter.UNREAD && unreadCountInChat > 0) {
                            "Ungelesen ($unreadCountInChat)"
                        } else {
                            item.label
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
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilledTonalButton(
                    onClick = onBack,
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück", modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Zurück")
                }

                if (instanceId != null) {
                    if (unreadCountInChat > 0) {
                        Button(
                            onClick = { vm.markChannelRead(instanceId) },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                        ) {
                            Icon(Icons.Default.DoneAll, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Alle gelesen ($unreadCountInChat)", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    } else {
                        OutlinedButton(
                            onClick = { vm.markChannelUnread(instanceId) },
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                        ) {
                            Icon(Icons.Default.MarkChatUnread, contentDescription = null, tint = FvColors.AccentHi, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Als ungelesen", color = FvColors.AccentHi, maxLines = 1)
                        }
                    }

                    IconButton(onClick = { channelMenuOpen = true }) {
                        Icon(Icons.Default.MoreHoriz, contentDescription = "Kanal-Aktionen", tint = FvColors.Text)
                    }
                } else {
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { vm.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Aktualisieren", tint = FvColors.Text)
                    }
                }
            }
        }
    }

    if (channelMenuOpen && instanceId != null) {
        val isMuted = channel?.mutedUntil != null && (channel.mutedUntil == -1L || channel.mutedUntil > System.currentTimeMillis())
        ModalBottomSheet(
            onDismissRequest = { channelMenuOpen = false },
            containerColor = FvColors.Panel,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                TextButton(onClick = { vm.refresh(); channelMenuOpen = false }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Jetzt synchronisieren", color = FvColors.Text)
                }
                HorizontalDivider(color = FvColors.Line)
                if (isMuted) {
                    TextButton(onClick = { vm.muteInstance(instanceId, null); channelMenuOpen = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("Stummschaltung aufheben", color = FvColors.Add)
                    }
                } else {
                    TextButton(onClick = { vm.muteInstance(instanceId, 3_600_000L); channelMenuOpen = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("1 Stunde stummschalten", color = FvColors.Text)
                    }
                    TextButton(onClick = { vm.muteInstance(instanceId, 8 * 3_600_000L); channelMenuOpen = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("8 Stunden stummschalten", color = FvColors.Text)
                    }
                    TextButton(onClick = { vm.muteInstance(instanceId, -1L); channelMenuOpen = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("Dauerhaft stummschalten", color = FvColors.Del)
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }

    selectedDetail?.let { item ->
        val liveItem = messages.firstOrNull { it.dto.seq == item.dto.seq } ?: item
        MessageDetailBottomSheet(
            item = liveItem,
            analyzingSeqs = analyzingSeqs,
            allowRollback = allowRollback,
            serverUrl = vm.prefs.serverUrl,
            onDismiss = { selectedDetail = null },
            onToggleUnread = { vm.setMessageUnread(liveItem.dto.seq, liveItem.dto.instance.id, !liveItem.unread) },
            onAnalyze = { vm.analyzeMessage(liveItem.dto.seq) },
            onRequestRollback = { wfId, verId ->
                selectedDetail = null
                vm.requestRollback(wfId, verId)
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RollbackBottomSheet(
    challenge: RollbackChallengeDto,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = FvColors.Panel,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.Fingerprint, contentDescription = null, tint = FvColors.AccentHi, modifier = Modifier.size(26.dp))
                Text(
                    "Version v${challenge.targetVersionNumber} zurückspielen?",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = FvColors.Text,
                )
            }
            Text(
                "Warum: Stellt den letzten stabilen Stand für „${challenge.workflowName}“ (${challenge.instanceName}) wieder her (v${challenge.currentVersionNumber} → v${challenge.targetVersionNumber}).",
                style = MaterialTheme.typography.bodyMedium,
                color = FvColors.Text,
            )
            Text(
                "Wie: Deine Biometrie schaltet den Hardware-Schlüssel im Android Keystore frei und signiert diese 60-Sekunden-Einmalfreigabe.",
                style = MaterialTheme.typography.bodySmall,
                color = FvColors.Muted,
            )
            Button(
                enabled = !busy,
                onClick = onConfirm,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
            ) {
                if (busy) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = FvColors.Text)
                } else {
                    Icon(Icons.Default.Fingerprint, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Mit Biometrie bestätigen", fontWeight = FontWeight.SemiBold)
                }
            }
            OutlinedButton(
                enabled = !busy,
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth().height(46.dp),
            ) {
                Text("Abbrechen", color = FvColors.Muted)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun MessageDetailBottomSheet(
    item: UiChatMessage,
    analyzingSeqs: Set<Long>,
    allowRollback: Boolean,
    serverUrl: String?,
    onDismiss: () -> Unit,
    onToggleUnread: () -> Unit,
    onAnalyze: () -> Unit,
    onRequestRollback: (Int, Int) -> Unit,
) {
    val context = LocalContext.current
    val msg = item.dto
    val liveDiag = item.diagnosis
    val isUnread = item.unread
    val rollbackVerId = msg.metadata.rollback?.versionId ?: liveDiag?.rollbackVersionId
    val rollbackVerNum = msg.metadata.rollback?.number ?: liveDiag?.rollbackVersionNumber

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = FvColors.Panel,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(msg.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
            Text(
                "${msg.instance.name} · ${SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.GERMANY).format(Date(msg.updatedAt))}",
                style = MaterialTheme.typography.labelSmall,
                color = FvColors.Dim,
            )
            liveDiag?.let { DiagnosisBox(it) }

            Text("Technische Rohdaten (WHAT)", style = MaterialTheme.typography.labelMedium, color = FvColors.Muted)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(FvColors.Panel3)
                    .padding(12.dp),
            ) {
                Text(
                    msg.metadata.errorMessage ?: msg.body,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                    color = FvColors.Text,
                )
            }
            msg.metadata.failingNodes?.takeIf { it.isNotEmpty() }?.let { nodes ->
                Text("Betroffene Nodes", style = MaterialTheme.typography.labelMedium, color = FvColors.Muted)
                nodes.forEach { n ->
                    Text(
                        "• ${n.name} (${Math.round(n.rate * 100)} %, ${n.failed}×) ${n.lastMessage.orEmpty()}",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = FvColors.Muted,
                    )
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AssistChip(
                    onClick = onToggleUnread,
                    label = { Text(if (isUnread) "Als gelesen markieren" else "Als ungelesen markieren") },
                    leadingIcon = {
                        Icon(
                            if (isUnread) Icons.Default.MarkEmailRead else Icons.Default.MarkEmailUnread,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                    },
                )
                if (MessageCategoryHelper.isFail(msg.kind) && msg.workflow != null) {
                    AssistChip(
                        onClick = onAnalyze,
                        label = { Text(if (analyzingSeqs.contains(msg.seq)) "Analysiere…" else "Ursache analysieren") },
                        leadingIcon = { Icon(Icons.Default.AutoFixHigh, contentDescription = null, modifier = Modifier.size(16.dp)) },
                    )
                }
                if (msg.workflow != null && rollbackVerId != null && rollbackVerNum != null && allowRollback) {
                    AssistChip(
                        onClick = { onRequestRollback(msg.workflow.id, rollbackVerId) },
                        label = { Text("Auf v$rollbackVerNum zurückspielen") },
                        leadingIcon = { Icon(Icons.Default.Restore, contentDescription = null, modifier = Modifier.size(16.dp)) },
                    )
                }
                AssistChip(
                    onClick = {
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("FlowVault", msg.metadata.errorMessage ?: msg.body))
                    },
                    label = { Text("Kopieren") },
                    leadingIcon = { Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp)) },
                )
                if (!msg.metadata.webPath.isNullOrBlank()) {
                    AssistChip(
                        onClick = { openInWeb(context, serverUrl, msg.metadata.webPath) },
                        label = { Text("In FlowVault öffnen") },
                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp)) },
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SwipeableMessageCard(
    msg: MessageDto,
    unread: Boolean,
    diagnosis: DiagnosisDto?,
    isAnalyzing: Boolean,
    allowRollback: Boolean,
    rollbackBusy: Boolean,
    rollbackVersionNumber: Int?,
    showInstance: Boolean,
    onOpenSheet: () -> Unit,
    onToggleUnread: () -> Unit,
    onAnalyze: () -> Unit,
    onRollback: () -> Unit,
    onOpenWeb: () -> Unit,
    onDismissAlert: () -> Unit,
    onMuteWorkflow: () -> Unit,
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.StartToEnd || value == SwipeToDismissBoxValue.EndToStart) {
                onToggleUnread()
            }
            false
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
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (unread) FvColors.Add.copy(alpha = 0.24f) else FvColors.Accent.copy(alpha = 0.24f))
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (alignEnd) Arrangement.End else Arrangement.Start,
            ) {
                Icon(
                    if (unread) Icons.Default.MarkChatRead else Icons.Default.MarkChatUnread,
                    contentDescription = null,
                    tint = if (unread) FvColors.Add else FvColors.AccentHi,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    if (unread) "Als gelesen" else "Als ungelesen",
                    fontWeight = FontWeight.SemiBold,
                    color = FvColors.Text,
                )
            }
        },
        content = {
            GoldenCircleMessengerCard(
                msg = msg,
                unread = unread,
                diagnosis = diagnosis,
                isAnalyzing = isAnalyzing,
                allowRollback = allowRollback,
                rollbackBusy = rollbackBusy,
                rollbackVersionNumber = rollbackVersionNumber,
                showInstance = showInstance,
                onOpenSheet = onOpenSheet,
                onToggleUnread = onToggleUnread,
                onAnalyze = onAnalyze,
                onRollback = onRollback,
                onOpenWeb = onOpenWeb,
                onDismissAlert = onDismissAlert,
                onMuteWorkflow = onMuteWorkflow,
            )
        },
    )
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
internal fun GoldenCircleMessengerCard(
    msg: MessageDto,
    unread: Boolean,
    diagnosis: DiagnosisDto?,
    isAnalyzing: Boolean,
    allowRollback: Boolean,
    rollbackBusy: Boolean,
    rollbackVersionNumber: Int?,
    showInstance: Boolean,
    onOpenSheet: () -> Unit,
    onToggleUnread: () -> Unit,
    onAnalyze: () -> Unit,
    onRollback: () -> Unit,
    onOpenWeb: () -> Unit,
    onDismissAlert: () -> Unit,
    onMuteWorkflow: () -> Unit,
) {
    val framing = remember(msg) { GoldenCircleCopy.frame(msg) }
    var showRawWhat by remember { mutableStateOf(false) }

    val stripeColor: Color = when {
        MessageCategoryHelper.isRecovery(msg.kind) -> FvColors.Add
        msg.severity == "critical" || msg.kind == "execution_failed" || msg.kind == "workflow_deleted" -> FvColors.Del
        msg.kind == "workflow_changed" || msg.kind == "health_poll_error" -> FvColors.Mod
        msg.kind == "workflow_created" -> FvColors.Add
        else -> FvColors.Info
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(14.dp))
            .background(if (unread) FvColors.Panel2 else FvColors.Panel)
            .border(
                width = 1.dp,
                color = if (unread) FvColors.Accent.copy(alpha = 0.55f) else FvColors.Line,
                shape = RoundedCornerShape(14.dp),
            )
            .combinedClickable(onClick = onOpenSheet, onLongClick = onToggleUnread),
    ) {
        Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(stripeColor))
        Column(
            modifier = Modifier.weight(1f).padding(13.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // ─── 1. WHY: Bedeutung & Auswirkung ───
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (unread) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(FvColors.Accent))
                }
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(stripeColor.copy(alpha = 0.18f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(framing.whyBadge, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = stripeColor)
                }
                if (showInstance) {
                    Text(msg.instance.name, style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                }
                if (msg.groupCount > 1) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(FvColors.Del.copy(alpha = 0.25f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text("×${msg.groupCount}", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = FvColors.Text)
                    }
                }
                Spacer(Modifier.weight(1f))
                Text(formatRelativeTime(msg.updatedAt), style = MaterialTheme.typography.labelSmall, color = if (unread) FvColors.AccentHi else FvColors.Dim)
            }

            Text(
                framing.whyHeadline,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold,
                color = FvColors.Text,
            )
            Text(
                framing.whyImpact,
                style = MaterialTheme.typography.bodySmall,
                color = FvColors.Muted,
            )

            msg.metadata.aiSummary?.details?.takeIf { it.isNotEmpty() }?.let { bullets ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    bullets.take(3).forEach { bullet ->
                        Text("• $bullet", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                    }
                }
            }

            // ─── 2. HOW: Empfehlung, E2E-Diagnose & daumenfreundliche Aktions-Buttons ───
            if (diagnosis != null) {
                DiagnosisBox(diagnosis)
            } else if (framing.howRecommendation != null && msg.resolvedBySeq == null) {
                Text(
                    "Nächster Schritt: ${framing.howRecommendation}",
                    style = MaterialTheme.typography.labelSmall,
                    color = FvColors.AccentHi,
                )
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (MessageCategoryHelper.isFail(msg.kind) && msg.workflow != null) {
                    TextButton(
                        onClick = onAnalyze,
                        enabled = !isAnalyzing,
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        if (isAnalyzing) {
                            CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.8.dp, color = FvColors.AccentHi)
                            Spacer(Modifier.width(5.dp))
                            Text("Analysiere…", style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                        } else {
                            Icon(Icons.Default.AutoFixHigh, contentDescription = null, modifier = Modifier.size(14.dp), tint = FvColors.AccentHi)
                            Spacer(Modifier.width(4.dp))
                            Text(if (diagnosis == null) "Ursache analysieren" else "Neu analysieren", style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                        }
                    }
                }
                if (msg.workflow != null && rollbackVersionNumber != null && msg.resolvedBySeq == null) {
                    TextButton(
                        onClick = onRollback,
                        enabled = !rollbackBusy,
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Icon(
                            if (allowRollback) Icons.Default.Fingerprint else Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = if (allowRollback) FvColors.Add else FvColors.Dim,
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "Auf v$rollbackVersionNumber zurückspielen",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (allowRollback) FvColors.Add else FvColors.Dim,
                        )
                    }
                }
                TextButton(
                    onClick = onToggleUnread,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Icon(
                        if (unread) Icons.Default.MarkEmailRead else Icons.Default.MarkEmailUnread,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = if (unread) FvColors.AccentHi else FvColors.Dim,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        if (unread) "Als gelesen" else "Ungelesen",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (unread) FvColors.AccentHi else FvColors.Dim,
                    )
                }
            }

            // ─── 3. WHAT: Technische Rohdaten auf Wunsch einblenden ───
            HorizontalDivider(color = FvColors.Line)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showRawWhat = !showRawWhat }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                val metaLabel = buildString {
                    msg.workflow?.let { append(it.name) }
                    msg.version?.let { append(" · v${it.number}") }
                    if (isEmpty()) append("Technische Details")
                }
                Text(metaLabel, style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = FvColors.Dim, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (showRawWhat) "Weniger" else "Details", style = MaterialTheme.typography.labelSmall, color = FvColors.Dim)
                    Icon(if (showRawWhat) Icons.Default.ExpandLess else Icons.Default.ExpandMore, contentDescription = null, tint = FvColors.Dim, modifier = Modifier.size(16.dp))
                }
            }

            AnimatedVisibility(visible = showRawWhat) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(FvColors.Panel3)
                            .padding(10.dp),
                    ) {
                        Text(
                            msg.metadata.errorMessage ?: msg.body,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            color = FvColors.Muted,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (!msg.metadata.webPath.isNullOrBlank()) {
                            TextButton(onClick = onOpenWeb, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                                Text("Im Web öffnen", style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                            }
                        }
                        if ((msg.kind == "alert_opened" || msg.kind == "alert_escalated") && msg.alertId != null && msg.resolvedBySeq == null) {
                            TextButton(onClick = onDismissAlert, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                                Text("Warnung ausblenden", style = MaterialTheme.typography.labelSmall, color = FvColors.Muted)
                            }
                        }
                        if (msg.workflow != null) {
                            TextButton(onClick = onMuteWorkflow, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                                Text("1h stumm", style = MaterialTheme.typography.labelSmall, color = FvColors.Dim)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun DiagnosisBox(diag: DiagnosisDto) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(FvColors.Panel3)
            .border(1.dp, FvColors.Accent.copy(alpha = 0.4f), RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(12.dp), tint = FvColors.Add)
            Text(
                if (diag.source == "ai") "KI-DIAGNOSE · E2E-VERSCHLÜSSELT" else "DIFF-DIAGNOSE · E2E-VERSCHLÜSSELT",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = FvColors.AccentHi,
            )
        }
        Text(diag.headline, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
        Text(diag.cause, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
        diag.culpritChange?.let { culprit ->
            Text("Auslösende Änderung: $culprit", style = MaterialTheme.typography.bodySmall, color = FvColors.Mod)
        }
        diag.suggestedFix.forEach { step ->
            Text("→ $step", style = MaterialTheme.typography.bodySmall, color = FvColors.Text)
        }
    }
}

internal fun openInWeb(context: Context, serverUrl: String?, webPath: String?) {
    if (serverUrl.isNullOrBlank() || webPath.isNullOrBlank()) return
    val fullUrl = "${serverUrl.trimEnd('/')}/${webPath.trimStart('/')}"
    runCatching {
        CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(fullUrl))
    }
}
