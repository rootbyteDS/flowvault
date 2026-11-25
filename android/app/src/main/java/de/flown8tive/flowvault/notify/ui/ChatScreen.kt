package de.flown8tive.flowvault.notify.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
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
import de.flown8tive.flowvault.notify.model.MessageCategoryHelper
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class ChatFilter(val label: String) {
    ALL("Alle"),
    FAILS("Fails"),
    CHANGES("Änderungen"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    vm: AppViewModel,
    instanceId: Int?, // null = Offene kritische Warnungen über alle Instanzen
    title: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val rawMessages by remember(instanceId) {
        if (instanceId != null) vm.messagesForInstance(instanceId) else vm.openAlerts
    }.collectAsState(initial = emptyList())

    var filter by remember { mutableStateOf(ChatFilter.ALL) }
    var selectedDetail by remember { mutableStateOf<MessageDto?>(null) }
    val listState = rememberLazyListState()

    DisposableEffect(instanceId) {
        vm.setActiveInstance(instanceId)
        onDispose { vm.setActiveInstance(null) }
    }

    val messages = remember(rawMessages, filter) {
        rawMessages.map { it.toDto() }.filter { m ->
            when (filter) {
                ChatFilter.ALL -> true
                ChatFilter.FAILS -> MessageCategoryHelper.isFail(m.kind) || MessageCategoryHelper.isRecovery(m.kind)
                ChatFilter.CHANGES -> MessageCategoryHelper.isChange(m.kind)
            }
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty() && instanceId != null) {
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
                        Text("${messages.size} Meldungen", style = MaterialTheme.typography.labelSmall, color = FvColors.Muted)
                    }
                },
                actions = {
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
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ChatFilter.entries.forEach { item ->
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
            }

            if (messages.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Noch keine Nachrichten in diesem Kanal.", color = FvColors.Dim)
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(messages, key = { it.seq }) { msg ->
                        MessengerCard(
                            msg = msg,
                            showInstance = instanceId == null,
                            onClick = { selectedDetail = msg },
                            onOpenWeb = { openInWeb(context, vm.prefs.serverUrl, msg.metadata.webPath) },
                            onDismissAlert = { msg.alertId?.let { vm.dismissAlert(it) } },
                            onMuteWorkflow = { msg.workflow?.id?.let { vm.muteWorkflow(it, 3_600_000L) } },
                        )
                    }
                }
            }
        }
    }

    selectedDetail?.let { msg ->
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
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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

@Composable
private fun MessengerCard(
    msg: MessageDto,
    showInstance: Boolean,
    onClick: () -> Unit,
    onOpenWeb: () -> Unit,
    onDismissAlert: () -> Unit,
    onMuteWorkflow: () -> Unit,
) {
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
            .background(FvColors.Panel)
            .clickable(onClick = onClick),
    ) {
        Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(stripeColor))
        Column(
            modifier = Modifier.weight(1f).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(stripeColor.copy(alpha = 0.18f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(MessageCategoryHelper.badgeLabel(msg.kind), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = stripeColor)
                }
                if (showInstance) {
                    Text(msg.instance.name, style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                }
                msg.version?.let { v ->
                    Text("v${v.number}", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = FvColors.Muted)
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
                Text(formatRelativeTime(msg.updatedAt), style = MaterialTheme.typography.labelSmall, color = FvColors.Dim)
            }

            Text(msg.title, fontWeight = FontWeight.SemiBold, color = FvColors.Text)

            msg.metadata.aiSummary?.let { ai ->
                Text(ai.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, color = FvColors.AccentHi)
                ai.details.take(3).forEach { bullet ->
                    Text("• $bullet", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                }
            }

            Text(
                msg.body,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = if (MessageCategoryHelper.isFail(msg.kind)) FontFamily.Monospace else FontFamily.Default,
                color = FvColors.Muted,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )

            msg.metadata.rollback?.let { rb ->
                Text(
                    "Vorschlag: Zurücksetzen auf v${rb.number} (${rb.rate?.let { "${Math.round(it * 100)} %" } ?: "stabil"})",
                    style = MaterialTheme.typography.labelSmall,
                    color = FvColors.Add,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!msg.metadata.webPath.isNullOrBlank()) {
                    TextButton(onClick = onOpenWeb, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                        Text("Im Web öffnen", style = MaterialTheme.typography.labelSmall, color = FvColors.AccentHi)
                    }
                }
                if ((msg.kind == "alert_opened" || msg.kind == "alert_escalated") && msg.alertId != null && msg.resolvedBySeq == null) {
                    TextButton(onClick = onDismissAlert, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                        Text("Ausblenden", style = MaterialTheme.typography.labelSmall, color = FvColors.Muted)
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

private fun openInWeb(context: Context, serverUrl: String?, webPath: String?) {
    if (serverUrl.isNullOrBlank() || webPath.isNullOrBlank()) return
    val fullUrl = "${serverUrl.trimEnd('/')}/${webPath.trimStart('/')}"
    runCatching {
        CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(fullUrl))
    }
}
