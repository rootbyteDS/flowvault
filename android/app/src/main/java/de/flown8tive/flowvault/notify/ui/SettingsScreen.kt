package de.flown8tive.flowvault.notify.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
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
    val prefs = vm.prefs
    val distributors = remember { UnifiedPushManager.discoverDistributors(context) }

    var deliveryMode by remember { mutableStateOf(prefs.deliveryMode) }
    var hideLockscreen by remember { mutableStateOf(prefs.hideLockscreenDetails) }
    var quietHours by remember { mutableStateOf(prefs.quietHours) }

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
                title = { Text("Einstellungen", fontWeight = FontWeight.SemiBold, color = FvColors.Text) },
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
            SettingsCard("Zustellung & Echtzeit") {
                DeliveryOption(
                    selected = deliveryMode == DeliveryMode.UNIFIED_PUSH,
                    title = "UnifiedPush (Empfohlen)",
                    subtitle = if (distributors.isNotEmpty()) {
                        "Zero-Payload-Wakeup über ${distributors.joinToString { it.label }} – Doze-sicher & Google-frei"
                    } else {
                        "Kein Distributor gefunden (installiere z. B. ntfy oder Sunup)"
                    },
                    onClick = {
                        deliveryMode = DeliveryMode.UNIFIED_PUSH
                        vm.setDeliveryMode(DeliveryMode.UNIFIED_PUSH)
                    },
                )
                DeliveryOption(
                    selected = deliveryMode == DeliveryMode.REALTIME_SERVICE,
                    title = "Echtzeit-Hintergrunddienst (SSE)",
                    subtitle = "Direkte Live-Verbindung zu FlowVault ohne Zusatzserver (ideal für LAN/Tailscale)",
                    onClick = {
                        deliveryMode = DeliveryMode.REALTIME_SERVICE
                        vm.setDeliveryMode(DeliveryMode.REALTIME_SERVICE)
                    },
                )
                DeliveryOption(
                    selected = deliveryMode == DeliveryMode.PERIODIC,
                    title = "Periodischer Sync (WorkManager)",
                    subtitle = "Minimaler Akkuverbrauch, Abruf im Hintergrund alle ~15 Minuten",
                    onClick = {
                        deliveryMode = DeliveryMode.PERIODIC
                        vm.setDeliveryMode(DeliveryMode.PERIODIC)
                    },
                )
                OutlinedButton(
                    onClick = {
                        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        }
                        runCatching { context.startActivity(intent) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Android-Benachrichtigungskanäle öffnen")
                }
            }

            SettingsCard("Ruhezeiten (Quiet Hours)") {
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
                        Text("Kritische Warnungen durchlassen", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
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

            SettingsCard("Privatsphäre") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Details auf Sperrbildschirm verbergen", color = FvColors.Text)
                        Text("Zeigt dort nur „Neue Meldung in FlowVault“ ohne Fehlerdetails", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                    }
                    Switch(
                        checked = hideLockscreen,
                        onCheckedChange = {
                            hideLockscreen = it
                            vm.setHideLockscreen(it)
                        },
                    )
                }
            }

            SettingsCard("Verbindung, Kryptografie & Gerät") {
                Text("Server: ${prefs.serverUrl ?: "-"}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                Text("Gerät: ${prefs.deviceName} (ID #${prefs.deviceId})", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                Text("FlowVault-Version: ${prefs.serverVersion.ifBlank { "unbekannt" }}", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                Text("Diagnose-Verschlüsselung: Ende-zu-Ende (ECDH P-256 + AES-256-GCM)", style = MaterialTheme.typography.bodySmall, color = FvColors.Add)
                Text(
                    "Signiertes Rollback: ${if (prefs.allowRollback) "Aktiv (Hardware-Keystore + Biometrie)" else "Gesperrt (in FlowVault Web freigeben)"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (prefs.allowRollback) FvColors.Add else FvColors.Muted,
                )
                Text("Schwärzung: ${prefs.redactionMode}", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
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
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(FvColors.Panel)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = FvColors.AccentHi)
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
