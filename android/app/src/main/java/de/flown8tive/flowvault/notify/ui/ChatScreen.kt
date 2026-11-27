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
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import de.flown8tive.flowvault.notify.data.MessageEntity
import de.flown8tive.flowvault.notify.model.DiagnosisDto
import de.flown8tive.flowvault.notify.model.GoldenCircleCopy
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class ChatFilter(val label: String) {
    ALL("Alle"),
    UNREAD("Ungelesen"),
    FAILS("Störungen"),
    CHANGES("Änderungen"),
}

private data class UiChatMessage(
    val dto: MessageDto,
    val unread: Boolean,
    val diagnosis: DiagnosisDto?,
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ChatScreen(
    vm: AppViewModel,
    instanceId: Int?,
    title: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val rawMessages: List<MessageEntity> by remember(instanceId) {
        if (instanceId != null) vm.messagesForInstance(instanceId) else vm.openAlerts
    }.collectAsState(initial = emptyList())

    val allowRollback by vm.allowRollback.collectAsState()
    val analyzingSeqs by vm.analyzingSeqs.collectAsState()
    val pendingRollback by vm.pendingRollback.collectAsState()
    val rollbackBusy by vm.rollbackBusy.collectAsState()

    var filter by remember { mutableStateOf(ChatFilter.ALL) }
    var selectedDetail by remember { mutableStateOf<UiChatMessage?>(null) }
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

    LaunchedEffect(rawMessages.size) {
        if (messages.isNotEmpty() && instanceId != null && filter == ChatFilter.ALL) {
            listState.scrollToItem(messages.lastIndex)
        }
    }

    Scaffold(
        containerColor = FvColors.Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = FvColors.Sidebar),
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück", tint = FvColors.Text)
                    }
                },
                title = {
                    Column {
                        Text(title, fontWeight = FontWeight.SemiBold, color = FvColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val sub = if (unreadCountInChat > 0) {
                            "$unreadCountInChat ungelesen · ${rawMessages.size} gesamt"
                        } else {
                            "Alle gelesen · ${rawMessages.size} Meldungen"
                        }
                        Text(sub, style = MaterialTheme.typography.labelSmall, color = if (unreadCountInChat > 0) FvColors.AccentHi else FvColors.Muted)
                    }
                },
                actions = {
                    if (instanceId != null && unreadCountInChat > 0) {
                        IconButton(onClick = { vm.markChannelRead(instanceId) }) {
                            Icon(Icons.Default.DoneAll, contentDescription = "Alle als gelesen markieren", tint = FvColors.Add)
                        }
                    }
                    if (instanceId != null) {
                        IconButton(onClick = { vm.muteInstance(instanceId, 3_600_000L) }) {
                            Icon(Icons.Default.NotificationsOff, contentDescription = "1h stumm", tint = FvColors.Muted)
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (instanceId != null) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(ChatFilter.entries) { item ->
                        val label = if (item == ChatFilter.UNREAD && unreadCountInChat > 0) {
                            "Ungelesen ($unreadCountInChat)"
                        } else {
                            item.label
                        }
                        FilterChip(
                            selected = filter == item,
                            onClick = { filter = item },
                            label = { Text(label) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = FvColors.AccentStrong,
                                selectedLabelColor = FvColors.Text,
                            ),
                        )
                    }
                }
            }

            if (messages.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (filter == ChatFilter.UNREAD) "Keine ungelesenen Meldungen in diesem Kanal." else "Noch keine Nachrichten in diesem Kanal.",
                        color = FvColors.Dim,
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(messages, key = { it.dto.seq }) { item ->
                        val msg = item.dto
                        val rollbackVerId = msg.metadata.rollback?.versionId ?: item.diagnosis?.rollbackVersionId
                        val rollbackVerNum = msg.metadata.rollback?.number ?: item.diagnosis?.rollbackVersionNumber
                        GoldenCircleMessengerCard(
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
                                    vm.showBanner("Rollback in FlowVault Web unter „Einstellungen → Mobile App“ für dieses Gerät freischalten.")
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
        }
    }

    // Bestätigungsdialog + Biometrische Hardware-Signatur vor dem Zurückspielen in n8n
    pendingRollback?.let { ch ->
        AlertDialog(
            onDismissRequest = { if (!rollbackBusy) vm.cancelRollback() },
            containerColor = FvColors.Panel,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null, tint = FvColors.AccentHi)
                    Text("Version v${ch.targetVersionNumber} zurückspielen?", color = FvColors.Text)
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Warum: Stellt den letzten stabilen Stand wieder her.\n\nInstanz: ${ch.instanceName}\nWorkflow: ${ch.workflowName}\nWechsel: v${ch.currentVersionNumber} → v${ch.targetVersionNumber}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = FvColors.Text,
                    )
                    Text(
                        "Wie: Deine Biometrie schaltet den Hardware-Schlüssel im Android Keystore frei und signiert diese 60s-Einmal-Freigabe.",
                        style = MaterialTheme.typography.bodySmall,
                        color = FvColors.Muted,
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = !rollbackBusy,
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                    onClick = {
                        if (activity == null) {
                            vm.showBanner("Biometrische Bestätigung nicht verfügbar")
                            return@Button
                        }
                        BiometricAuthHelper.authenticateForRollback(
                            activity = activity,
                            title = "Auf v${ch.targetVersionNumber} zurückspielen",
                            subtitle = "${ch.instanceName} · ${ch.workflowName}",
                            description = "Bestätige das signierte Zurückspielen von v${ch.currentVersionNumber} auf v${ch.targetVersionNumber}.",
                            onAuthorized = { vm.executeConfirmedRollback(ch) },
                            onError = { err -> vm.showBanner(err) },
                        )
                    },
                ) {
                    if (rollbackBusy) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = FvColors.Text)
                    } else {
                        Text("Mit Biometrie bestätigen")
                    }
                }
            },
            dismissButton = {
                TextButton(enabled = !rollbackBusy, onClick = { vm.cancelRollback() }) {
                    Text("Abbrechen", color = FvColors.Muted)
                }
            },
        )
    }

    selectedDetail?.let { item ->
        val msg = item.dto
        val liveItem = messages.firstOrNull { it.dto.seq == msg.seq } ?: item
        val liveDiag = liveItem.diagnosis
        val isUnread = liveItem.unread
        val rollbackVerId = msg.metadata.rollback?.versionId ?: liveDiag?.rollbackVersionId
        val rollbackVerNum = msg.metadata.rollback?.number ?: liveDiag?.rollbackVersionNumber

        ModalBottomSheet(
            onDismissRequest = { selectedDetail = null },
            containerColor = FvColors.Panel,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
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
                        onClick = { vm.setMessageUnread(msg.seq, msg.instance.id, !isUnread) },
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
                            onClick = { vm.analyzeMessage(msg.seq) },
                            label = { Text(if (analyzingSeqs.contains(msg.seq)) "Analysiere…" else "Ursache analysieren") },
                            leadingIcon = { Icon(Icons.Default.AutoFixHigh, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        )
                    }
                    if (msg.workflow != null && rollbackVerId != null && rollbackVerNum != null && allowRollback) {
                        AssistChip(
                            onClick = {
                                selectedDetail = null
                                vm.requestRollback(msg.workflow.id, rollbackVerId)
                            },
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
                            onClick = { openInWeb(context, vm.prefs.serverUrl, msg.metadata.webPath) },
                            label = { Text("In FlowVault öffnen") },
                            leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/**
 * Nachrichten-Karte nach dem Golden-Circle-Prinzip:
 * 1. WHY (Bedeutung & Auswirkung sofort erfassbar)
 * 2. HOW (Empfohlene Reaktion, E2E-Diagnose & direkte Buttons inkl. Gelesen/Ungelesen)
 * 3. WHAT (Technische Rohdaten, Nodes & Nebenaktionen aufklappbar)
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun GoldenCircleMessengerCard(
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

            // KI-Stichpunkte bei Workflow-Änderungen
            msg.metadata.aiSummary?.details?.takeIf { it.isNotEmpty() }?.let { bullets ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    bullets.take(3).forEach { bullet ->
                        Text("• $bullet", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                    }
                }
            }

            // ─── 2. HOW: Empfehlung, E2E-Diagnose & Handlungs-Buttons ───
            if (diagnosis != null) {
                DiagnosisBox(diagnosis)
            } else if (framing.howRecommendation != null && msg.resolvedBySeq == null) {
                Text(
                    "Nächster Schritt: ${framing.howRecommendation}",
                    style = MaterialTheme.typography.labelSmall,
                    color = FvColors.AccentHi,
                )
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (MessageCategoryHelper.isFail(msg.kind) && msg.workflow != null) {
                    TextButton(
                        onClick = onAnalyze,
                        enabled = !isAnalyzing,
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
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
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
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
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
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
                    .padding(vertical = 2.dp),
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
private fun DiagnosisBox(diag: DiagnosisDto) {
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

private fun openInWeb(context: Context, serverUrl: String?, webPath: String?) {
    if (serverUrl.isNullOrBlank() || webPath.isNullOrBlank()) return
    val fullUrl = "${serverUrl.trimEnd('/')}/${webPath.trimStart('/')}"
    runCatching {
        CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(fullUrl))
    }
}
