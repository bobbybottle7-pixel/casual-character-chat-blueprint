package app.camai

/** A small Markdown subset: headings, bullet/numbered lists, code blocks, **bold**, *italic*, `code`. */
sealed class MdBlock {
    data class Paragraph(val text: String) : MdBlock()
    data class Heading(val level: Int, val text: String) : MdBlock()
    data class ListItem(val marker: String, val text: String) : MdBlock()
    data class Code(val lang: String, val code: String) : MdBlock()
}

data class MdSpan(val text: String, val bold: Boolean = false, val italic: Boolean = false, val code: Boolean = false)

object Markdown {
    private val heading = Regex("^(#{1,6})\\s+(.*)$")
    private val listItem = Regex("^\\s*([-*•+]|\\d{1,3}[.)])\\s+(.*)$")

    fun parse(src: String): List<MdBlock> {
        val lines = src.replace("\r\n", "\n").split("\n")
        val out = mutableListOf<MdBlock>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trimStart()
            when {
                trimmed.startsWith("```") -> {
                    val lang = trimmed.removePrefix("```").trim()
                    val code = StringBuilder()
                    i++
                    while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                        if (code.isNotEmpty()) code.append('\n')
                        code.append(lines[i])
                        i++
                    }
                    out += MdBlock.Code(lang, code.toString())
                    i++  // skip the closing fence (or run past the end while still streaming)
                }
                heading.matches(trimmed) -> {
                    val m = heading.find(trimmed)!!
                    out += MdBlock.Heading(m.groupValues[1].length, m.groupValues[2].trim())
                    i++
                }
                listItem.matches(line) -> {
                    val m = listItem.find(line)!!
                    val marker = m.groupValues[1].let { if (it[0].isDigit()) it.trimEnd(')').trimEnd('.') + "." else "•" }
                    out += MdBlock.ListItem(marker, m.groupValues[2])
                    i++
                }
                trimmed.isEmpty() -> i++
                else -> {
                    val para = StringBuilder(line.trim())
                    i++
                    while (i < lines.size) {
                        val next = lines[i]
                        val t = next.trimStart()
                        if (t.isEmpty() || t.startsWith("```") || heading.matches(t) || listItem.matches(next)) break
                        para.append('\n').append(next.trim())
                        i++
                    }
                    out += MdBlock.Paragraph(para.toString())
                }
            }
        }
        return out
    }

    fun inline(text: String): List<MdSpan> {
        val spans = mutableListOf<MdSpan>()
        val buf = StringBuilder()
        var bold = false
        var italic = false
        fun flush() {
            if (buf.isNotEmpty()) spans += MdSpan(buf.toString(), bold, italic)
            buf.clear()
        }
        var i = 0
        while (i < text.length) {
            val c = text[i]
            when {
                c == '`' -> {
                    val end = text.indexOf('`', i + 1)
                    if (end > i) {
                        flush()
                        spans += MdSpan(text.substring(i + 1, end), code = true)
                        i = end + 1
                    } else {
                        buf.append(c); i++
                    }
                }
                (c == '*' || c == '_') && text.startsWith("$c$c", i) && (bold || hasCloser(text, i + 2, "$c$c")) -> {
                    flush(); bold = !bold; i += 2
                }
                (c == '*' || c == '_') && (italic || (i + 1 < text.length && !text[i + 1].isWhitespace() && hasCloser(text, i + 1, "$c"))) &&
                    !(c == '_' && i > 0 && text[i - 1].isLetterOrDigit()) -> {
                    flush(); italic = !italic; i++
                }
                else -> { buf.append(c); i++ }
            }
        }
        flush()
        return spans
    }

    private fun hasCloser(text: String, from: Int, marker: String) = text.indexOf(marker, from) > from
}
