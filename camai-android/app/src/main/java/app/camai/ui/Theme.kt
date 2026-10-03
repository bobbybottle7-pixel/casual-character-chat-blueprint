package app.camai.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Accent = Color(0xFF7DD3FC)
val Bg = Color(0xFF080A0D)
val Panel = Color(0xFF10141A)
val Panel2 = Color(0xFF151A21)
val UserBubble = Color(0xFF14202B)
val Muted = Color(0xFF8E9AAA)
val Line = Color(0xFF242B35)
val Bad = Color(0xFFFF9B9B)
val Good = Color(0xFF9FE3B1)
val Warn = Color(0xFFFFD38A)

private val colors = darkColorScheme(
    primary = Accent,
    onPrimary = Color(0xFF00121C),
    secondary = Accent,
    background = Bg,
    onBackground = Color(0xFFEDF1F7),
    surface = Panel,
    onSurface = Color(0xFFEDF1F7),
    surfaceVariant = Panel2,
    onSurfaceVariant = Muted,
    surfaceContainer = Panel,
    surfaceContainerLow = Panel,
    surfaceContainerHigh = Panel2,
    surfaceContainerHighest = Panel2,
    outline = Line,
    outlineVariant = Line,
    error = Bad,
)

@Composable
fun CamAITheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}

fun copyToClipboard(context: Context, text: String) {
    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("CamAI", text))
    if (android.os.Build.VERSION.SDK_INT < 33) Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
}
