package app.camai.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.Markdown
import app.camai.MdBlock

@Composable
fun MarkdownText(text: String, color: Color = MaterialTheme.colorScheme.onSurface) {
    val blocks = remember(text) { Markdown.parse(text) }
    SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (b in blocks) {
                when (b) {
                    is MdBlock.Paragraph -> Text(styled(b.text), color = color, style = MaterialTheme.typography.bodyLarge)
                    is MdBlock.Heading -> Text(
                        styled(b.text), color = color, fontWeight = FontWeight.Bold,
                        style = if (b.level <= 2) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
                    )
                    is MdBlock.ListItem -> Row {
                        Text(b.marker, color = Accent, style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.width(8.dp))
                        Text(styled(b.text), color = color, style = MaterialTheme.typography.bodyLarge)
                    }
                    is MdBlock.Code -> CodeBlock(b)
                }
            }
        }
    }
}

@Composable
private fun CodeBlock(b: MdBlock.Code) {
    val context = LocalContext.current
    Surface(color = Color(0xFF05070A), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 10.dp)) {
                Text(b.lang.ifEmpty { "code" }, color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                IconButton(onClick = { copyToClipboard(context, b.code) }) {
                    Icon(Icons.Filled.ContentCopy, contentDescription = "Copy code", tint = Muted, modifier = Modifier.size(18.dp))
                }
            }
            Text(
                b.code, fontFamily = FontFamily.Monospace, fontSize = 13.sp, softWrap = false, color = Color(0xFFDCE6F2),
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
            )
        }
    }
}

fun styled(text: String): AnnotatedString = buildAnnotatedString {
    for (s in Markdown.inline(text)) {
        withStyle(
            SpanStyle(
                fontWeight = if (s.bold) FontWeight.Bold else null,
                fontStyle = if (s.italic) FontStyle.Italic else null,
                fontFamily = if (s.code) FontFamily.Monospace else null,
                background = if (s.code) Color(0x33FFFFFF) else Color.Unspecified,
            ),
        ) { append(s.text) }
    }
}
