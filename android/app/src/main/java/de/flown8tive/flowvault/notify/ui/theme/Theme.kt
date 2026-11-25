package de.flown8tive.flowvault.notify.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** FlowVault / flown8tive Night Design System (identisch zu web/src/index.css). */
object FvColors {
    val Sidebar = Color(0xFF11151C)
    val Bg = Color(0xFF151A23)
    val Panel = Color(0xFF1A1F29)
    val Panel2 = Color(0xFF1C222D)
    val Panel3 = Color(0xFF232A36)
    val Line = Color(0x14EFE9DF)
    val Line2 = Color(0x22EFE9DF)

    val Text = Color(0xFFEFE9DF)
    val Muted = Color(0xFFA3A8B2)
    val Dim = Color(0xFF80868F)

    val Accent = Color(0xFFC2663F)
    val AccentHi = Color(0xFFE39A70)
    val AccentStrong = Color(0xFFA9552F)

    val Add = Color(0xFF4CC38A)
    val Del = Color(0xFFE5484D)
    val Mod = Color(0xFFD9B44A)
    val Info = Color(0xFF8AAED9)
}

private val FlowVaultDarkScheme = darkColorScheme(
    primary = FvColors.Accent,
    onPrimary = Color.White,
    primaryContainer = FvColors.AccentStrong,
    onPrimaryContainer = FvColors.Text,
    secondary = FvColors.AccentHi,
    onSecondary = FvColors.Sidebar,
    background = FvColors.Bg,
    onBackground = FvColors.Text,
    surface = FvColors.Panel,
    onSurface = FvColors.Text,
    surfaceVariant = FvColors.Panel3,
    onSurfaceVariant = FvColors.Muted,
    outline = FvColors.Line2,
    error = FvColors.Del,
    onError = Color.White,
)

@Composable
fun FlowVaultTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = FlowVaultDarkScheme,
        content = content,
    )
}

fun parseHexColor(hex: String, fallback: Color = FvColors.Accent): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(fallback)
