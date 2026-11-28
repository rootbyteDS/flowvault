package de.flown8tive.flowvault.notify.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import de.flown8tive.flowvault.notify.model.PairingTarget
import de.flown8tive.flowvault.notify.model.PairingUriParser
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import java.util.concurrent.Executors

/**
 * Einhand-Kopplungsansicht:
 * Ruhige Einführung im oberen Sichtbereich; QR-Scanner-Hauptbutton und manuelle Eingabe
 * liegen ergonomisch unten in Daumen-Reichweite.
 */
@Composable
fun PairingScreen(
    initialTarget: PairingTarget?,
    busy: Boolean,
    error: String?,
    onPair: (serverUrl: String, code: String, deviceName: String) -> Unit,
) {
    val context = LocalContext.current
    var serverUrl by remember(initialTarget) { mutableStateOf(initialTarget?.serverUrl ?: "https://") }
    var code by remember(initialTarget) { mutableStateOf(initialTarget?.code ?: "") }
    var deviceName by remember { mutableStateOf(Build.MODEL ?: "Android") }
    var scannerOpen by remember { mutableStateOf(false) }
    var manualOpen by remember(initialTarget) { mutableStateOf(initialTarget != null) }
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasCameraPermission = granted
        if (granted) scannerOpen = true
    }

    LaunchedEffect(initialTarget) {
        if (initialTarget != null) {
            onPair(initialTarget.serverUrl, initialTarget.code, deviceName)
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = FvColors.Bg) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            // ─── Oberer Sichtbereich (Golden Circle WHY) ───
            Column(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(top = 28.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(FvColors.Accent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.Shield, contentDescription = null, tint = FvColors.Text)
                    }
                    Column {
                        Text("FlowVault Notify", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = FvColors.Text)
                        Text("Echtzeit-Schutz für deine n8n-Instanzen", style = MaterialTheme.typography.bodySmall, color = FvColors.AccentHi)
                    }
                }

                Text(
                    "Warum: Sofort wissen, wenn ein Workflow ausfällt, Ende-zu-Ende-verschlüsselt die Ursache prüfen und per Fingerabdruck auf die letzte stabile Version zurückspielen.\n\nWie: Öffne in FlowVault Web „Einstellungen → Mobile App“ und tippe unten auf „QR-Code scannen“.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = FvColors.Muted,
                )
            }

            Spacer(Modifier.height(24.dp))

            // ─── Untere Daumen-Zone (Aktionen & Eingabe) ───
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (scannerOpen && hasCameraPermission) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(250.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .border(2.dp, FvColors.AccentHi, RoundedCornerShape(16.dp)),
                    ) {
                        QrCameraPreview(
                            onCodeScanned = { raw ->
                                val parsed = PairingUriParser.parse(raw)
                                if (parsed != null) {
                                    scannerOpen = false
                                    serverUrl = parsed.serverUrl
                                    code = parsed.code
                                    onPair(parsed.serverUrl, parsed.code, deviceName)
                                }
                            },
                        )
                    }
                    OutlinedButton(onClick = { scannerOpen = false }, modifier = Modifier.fillMaxWidth().height(50.dp)) {
                        Text("Scanner schließen")
                    }
                } else {
                    Button(
                        onClick = {
                            if (hasCameraPermission) scannerOpen = true
                            else cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = FvColors.Accent),
                    ) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                        Spacer(Modifier.size(10.dp))
                        Text("QR-Code scannen", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    }
                }

                if (!error.isNullOrBlank()) {
                    Text(error, color = FvColors.Del, style = MaterialTheme.typography.bodySmall)
                }

                TextButton(
                    onClick = { manualOpen = !manualOpen },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        if (manualOpen) "Manuelle Eingabe ausblenden" else "Oder Server-URL & Code manuell eingeben",
                        color = FvColors.Muted,
                    )
                }

                AnimatedVisibility(visible = manualOpen) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(FvColors.Panel)
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = { serverUrl = it },
                            label = { Text("FlowVault Server-URL") },
                            placeholder = { Text("https://flowvault.example.com") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = code,
                            onValueChange = { code = it },
                            label = { Text("Einmal-Kopplungscode") },
                            singleLine = true,
                            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = deviceName,
                            onValueChange = { deviceName = it },
                            label = { Text("Gerätename") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = { onPair(serverUrl, code, deviceName) },
                            enabled = !busy && serverUrl.length > 8 && code.isNotBlank(),
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = FvColors.AccentStrong),
                        ) {
                            if (busy) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = FvColors.Text)
                            } else {
                                Text("Gerät koppeln")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QrCameraPreview(onCodeScanned: (String) -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val reader = remember {
        MultiFormatReader().apply {
            setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
        }
    }
    var scanned by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose { executor.shutdown() }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener({
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }
                val resolutionSelector = ResolutionSelector.Builder()
                    .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build()
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(resolutionSelector)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { proxy: ImageProxy ->
                    if (!scanned) {
                        decodeQr(proxy, reader)?.let { text ->
                            scanned = true
                            previewView.post { onCodeScanned(text) }
                        }
                    }
                    proxy.close()
                }
                runCatching {
                    provider.unbindAll()
                    provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )
}

private fun decodeQr(image: ImageProxy, reader: MultiFormatReader): String? {
    val plane = image.planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val bytes = ByteArray(buffer.remaining())
    buffer.get(bytes)
    val source = PlanarYUVLuminanceSource(
        bytes,
        plane.rowStride,
        image.height,
        0,
        0,
        image.width,
        image.height,
        false,
    )
    val bitmap = BinaryBitmap(HybridBinarizer(source))
    return runCatching { reader.decodeWithState(bitmap).text }.getOrNull().also { reader.reset() }
}
