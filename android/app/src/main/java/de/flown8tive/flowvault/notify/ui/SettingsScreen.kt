package de.flown8tive.flowvault.notify.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.flown8tive.flowvault.notify.data.ConnectionState
import de.flown8tive.flowvault.notify.model.DeliveryMode
import de.flown8tive.flowvault.notify.push.UnifiedPushManager
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import java.util.TimeZone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val prefs = vm.prefs
    val connState by vm.connectionState.collectAsState()
    val lastHeartbeat by vm.lastHeartbeatAt.collectAsState()
    val busy by vm.busy.collectAsState()
    val distributors = remember { UnifiedPushManager.discoverDistributors(context) }

    var permStatus by remember { mutableStateOf(PermissionHelper.check(context)) }
    var deliveryMode by remember { mutableStateOf(prefs.deliveryMode) }
    var hideLockscreen by remember { mutableStateOf(prefs.hideLockscreenDetails) }
    var quietHours by remember { mutableStateOf(prefs.quietHours) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permStatus = PermissionHelper.check(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
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
                title = { Text("Schutz & Einstellungen", fontWeight = FontWeight.SemiBold, color = FvColors.Text) },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // ─── 1. GOLDEN CIRCLE: WHY & HOW – Echtzeit-Freigaben-Checkliste ───
            SettingsCard(
                title = "Echtzeit-Zuverlässigkeit & Freigaben",
                whySubtitle = "Damit dich Ausfälle auch bei gesperrtem Display und im Mobilfunk ohne Verzögerung erreichen.",
            ) {
                PermissionCheckRow(
                    ok = permStatus.notificationsGranted,
                    title = "1. System-Benachrichtigungen",
                    detail = if (permStatus.notificationsGranted) "Aktiv – kritische Alarme dürfen klingeln" else "Blockiert – bitte Benachrichtigungen zulassen",
                    actionLabel = "Öffnen",
                    onAction = { PermissionHelper.openNotificationSettings(context) },
                )
                HorizontalDivider(color = FvColors.Line)
                PermissionCheckRow(
                    ok = permStatus.batteryUnrestricted,
                    title = "2. Akku-Betrieb „Nicht eingeschränkt“",
                    detail = if (permStatus.batteryUnrestricted) {
                        "Optimal – Android darf die Live-Verbindung im Standby nicht kappen"
                    } else {
                        "Wichtigste Freigabe! Ohne sie kappt Android im Standby nach wenigen Minuten den Echtzeit-Stream."
                    },
                    actionLabel = if (permStatus.batteryUnrestricted) "Prüfen" else "Freigeben",
                    highlightAction = !permStatus.batteryUnrestricted,
                    onAction = { PermissionHelper.requestIgnoreBatteryOptimizations(context) },
                )
                HorizontalDivider(color = FvColors.Line)

                val heartbeatText = if (lastHeartbeat > 0L) formatRelativeTime(lastHeartbeat) else "noch kein Signal"
                val liveOk = connState == ConnectionState.LIVE
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(9.dp).clip(CircleShape).background(if (liveOk) FvColors.Add else FvColors.Mod))
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (liveOk) "3. Live-Verbindung steht" else "3. Live-Verbindung wird aufgebaut",
                            color = FvColors.Text,
                            fontWeight = FontWeight.Medium,
                        )
                        Text("Letzter Server-Heartbeat: $heartbeatText (Prüfung alle 20 s)", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = { vm.reconnectRealtime() },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Neu verbinden")
                    }
                    Button(
                        onClick = { vm.sendSelfTest() },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Echtzeit-Test")
                    }
                }
            }

            // ─── 2. HOW: Zustellweg & Ruhezeiten ───
            SettingsCard(
                title = "Zustellmodus",
                whySubtitle = "Wie dein Handy im Hintergrund mit FlowVault verbunden bleibt.",
            ) {
                DeliveryOption(
                    selected = deliveryMode == DeliveryMode.REALTIME_SERVICE,
                    title = "Echtzeit-Hintergrunddienst (Standard · ohne Extra-Tools)",
                    subtitle = "Hält eine eigene Live-Verbindung mit WLAN/5G-Auto-Reconnect offen (< 1 Sek. Latenz)",
                    onClick = {
                        deliveryMode = DeliveryMode.REALTIME_SERVICE
                        vm.setDeliveryMode(DeliveryMode.REALTIME_SERVICE)
                    },
                )
                DeliveryOption(
                    selected = deliveryMode == DeliveryMode.UNIFIED_PUSH,
                    title = "UnifiedPush (Optional mit ntfy / Sunup)",
                    subtitle = if (distributors.isNotEmpty()) {
                        "Zero-Payload-Wakeup über ${distributors.joinToString { it.label }}"
                    } else {
                        "Nur nötig, wenn du ohnehin schon ntfy/Sunup für mehrere Apps nutzt"
                    },
                    onClick = {
                        deliveryMode = DeliveryMode.UNIFIED_PUSH
                        vm.setDeliveryMode(DeliveryMode.UNIFIED_PUSH)
                    },
                )
                DeliveryOption(
                    selected = deliveryMode == DeliveryMode.PERIODIC,
                    title = "Akku-Sparmodus (Alle ~15 Minuten)",
                    subtitle = "Keine Dauerverbindung im Hintergrund, prüft nur periodisch",
                    onClick = {
                        deliveryMode = DeliveryMode.PERIODIC
                        vm.setDeliveryMode(DeliveryMode.PERIODIC)
                    },
                )
            }

            SettingsCard(
                title = "Fokus & Ruhezeiten",
                whySubtitle = "Ungestörter Feierabend – nur echte Produktions-Ausfälle dürfen durchklingeln.",
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Ruhezeiten aktivieren", color = FvColors.Text)
                    Switch(
                        checked = quietHours.enabled,
                        onCheckedChange = { quietHours = quietHours.copy(enabled = it, tz = TimeZone.getDefault().id) },
                    )
                }
                if (quietHours.enabled) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(
                            value = quietHours.start,
                            onValueChange = { quietHours = quietHours.copy(start = it) },
                            label = { Text("Von (HH:MM)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            value = quietHours.end,
                            onValueChange = { quietHours = quietHours.copy(end = it) },
                            label = { Text("Bis (HH:MM)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text("Kritische Störungen trotzdem durchlassen", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                        Switch(
                            checked = quietHours.allowCritical,
                            onCheckedChange = { quietHours = quietHours.copy(allowCritical = it) },
                        )
                    }
                }
                Button(
                    onClick = { vm.saveQuietHours(quietHours) },
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                ) {
                    Text("Ruhezeiten speichern")
                }
            }

            // ─── 3. WHAT: Privatsphäre, Kryptografie & Technische Gerätedaten ───
            SettingsCard(
                title = "Sicherheit & Technische Details",
                whySubtitle = "Kryptografischer Status dieses Geräts.",
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Details auf Sperrbildschirm verbergen", color = FvColors.Text)
                        Text("Zeigt gesperrt nur „Neue Meldung in FlowVault“ ohne Fehlermeldung", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                    }
                    Switch(
                        checked = hideLockscreen,
                        onCheckedChange = {
                            hideLockscreen = it
                            vm.setHideLockscreen(it)
                        },
                    )
                }
                HorizontalDivider(color = FvColors.Line)
                Text("Server: ${prefs.serverUrl ?: "-"}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                Text("Gerät: ${prefs.deviceName} (ID #${prefs.deviceId} · FlowVault ${prefs.serverVersion.ifBlank { "?" }})", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                Text("Diagnose-Schutz: Ende-zu-Ende (ECDH P-256 + AES-256-GCM)", style = MaterialTheme.typography.bodySmall, color = FvColors.Add)
                Text(
                    "Signiertes Rollback: ${if (prefs.allowRollback) "Freigegeben (Hardware-Keystore + Biometrie)" else "Gesperrt (in FlowVault Web freischaltbar)"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (prefs.allowRollback) FvColors.Add else FvColors.Muted,
                )
                Spacer(Modifier.height(4.dp))
                Button(
                    onClick = { vm.unpair() },
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.Del),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Gerät abmelden & lokale Daten löschen")
                }
            }
        }
    }
}

@Composable
private fun PermissionCheckRow(
    ok: Boolean,
    title: String,
    detail: String,
    actionLabel: String,
    highlightAction: Boolean = false,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            if (ok) Icons.Default.CheckCircle else Icons.Default.Warning,
            contentDescription = null,
            tint = if (ok) FvColors.Add else FvColors.Mod,
            modifier = Modifier.size(20.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(title, color = FvColors.Text, fontWeight = FontWeight.Medium)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
        }
        if (highlightAction) {
            Button(
                onClick = onAction,
                colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            ) {
                Text(actionLabel, style = MaterialTheme.typography.labelSmall)
            }
        } else {
            OutlinedButton(
                onClick = onAction,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            ) {
                Text(actionLabel, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun SettingsCard(title: String, whySubtitle: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(FvColors.Panel)
            .border(1.dp, FvColors.Line, RoundedCornerShape(14.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = FvColors.AccentHi)
            Text(whySubtitle, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
        }
        content()
    }
}

@Composable
private fun DeliveryOption(selected: Boolean, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Column(Modifier.weight(1f)) {
            Text(title, color = FvColors.Text, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
        }
    }
}
