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
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
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
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(FvColors.Accent),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Shield, contentDescription = null, tint = FvColors.Text)
                }
                Column {
                    Text("FlowVault Notify", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = FvColors.Text)
                    Text("Messenger für n8n Fails & Änderungen", style = MaterialTheme.typography.bodySmall, color = FvColors.Muted)
                }
            }

            Text(
                "Öffne in FlowVault „Einstellungen → Mobile App & Benachrichtigungen“, aktiviere den Zugang und scanne den QR-Code.",
                style = MaterialTheme.typography.bodyMedium,
                color = FvColors.Muted,
            )

            if (scannerOpen && hasCameraPermission) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp)
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
                OutlinedButton(onClick = { scannerOpen = false }, modifier = Modifier.fillMaxWidth()) {
                    Text("Scanner schließen")
                }
            } else {
                Button(
                    onClick = {
                        if (hasCameraPermission) scannerOpen = true
                        else cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = FvColors.Accent),
                ) {
                    Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("QR-Code scannen")
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(FvColors.Panel)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Oder manuell verbinden", style = MaterialTheme.typography.titleSmall, color = FvColors.Text)
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

                if (!error.isNullOrBlank()) {
                    Text(error, color = FvColors.Del, style = MaterialTheme.typography.bodySmall)
                }

                Button(
                    onClick = { onPair(serverUrl, code, deviceName) },
                    enabled = !busy && serverUrl.length > 8 && code.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
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

@Composable
private fun QrCameraPreview(onCodeScanned: (String) -> Unit) {
    val context = LocalContext.current
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
                val analysis = ImageAnalysis.Builder()
                    .setTargetResolution(Size(1280, 720))
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
