package dev.we3kings.nexusmoves.ui.chat

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import dev.we3kings.nexusmoves.ui.theme.Theme

/**
 * Minimal inline-markdown → AnnotatedString, matching what iOS renders with
 * AttributedString(markdown:, .inlineOnlyPreservingWhitespace): **bold**,
 * *italic* / _italic_, `code`, and [text](url) links. Block syntax (headings,
 * lists) is intentionally left as plain text — the agent uses inline emphasis.
 */
object InlineMarkdown {

    private val linkRegex = Regex("\\[([^\\]]+)]\\(([^)]+)\\)")

    fun parse(input: String): AnnotatedString = buildAnnotatedString {
        var i = 0
        val s = input
        while (i < s.length) {
            when {
                s.startsWith("**", i) -> {
                    val end = s.indexOf("**", i + 2)
                    if (end != -1) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(s.substring(i + 2, end)) }
                        i = end + 2
                    } else { append(s[i]); i++ }
                }
                (s[i] == '*' || s[i] == '_') -> {
                    val marker = s[i]
                    val end = s.indexOf(marker, i + 1)
                    if (end != -1 && end > i + 1) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(s.substring(i + 1, end)) }
                        i = end + 1
                    } else { append(s[i]); i++ }
                }
                s[i] == '`' -> {
                    val end = s.indexOf('`', i + 1)
                    if (end != -1) {
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(s.substring(i + 1, end)) }
                        i = end + 1
                    } else { append(s[i]); i++ }
                }
                s[i] == '[' -> {
                    val match = linkRegex.matchAt(s, i)
                    if (match != null) {
                        val text = match.groupValues[1]
                        val url = match.groupValues[2]
                        pushStringAnnotation("URL", url)
                        withStyle(SpanStyle(color = Theme.brand, fontWeight = FontWeight.Medium)) { append(text) }
                        pop()
                        i = match.range.last + 1
                    } else { append(s[i]); i++ }
                }
                else -> { append(s[i]); i++ }
            }
        }
    }
}
