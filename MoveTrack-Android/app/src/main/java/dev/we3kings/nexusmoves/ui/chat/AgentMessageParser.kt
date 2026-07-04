package dev.we3kings.nexusmoves.ui.chat

import java.util.UUID

/**
 * Port of iOS AgentMessageParser. Parses the agent's inline
 * `[BUTTONS]…[/BUTTONS]` blocks into tappable buttons and strips them (plus
 * `[IMG:…]` tokens) from the displayed prose. Mirrors the web contract in
 * movetrack-app NexusChat.vue:
 *
 *   [BUTTONS]
 *   Label|message to send|actions
 *   [/BUTTONS]
 *
 * actions ∈ {send, prefill, camera} (optional; inferred when omitted).
 */
enum class AgentButtonAction { Send, Prefill, Camera }

data class AgentButton(
    val label: String,
    val message: String,
    val actions: List<AgentButtonAction>,
    val id: String = UUID.randomUUID().toString(),
) {
    /** Single acted-on action (priority: prefill > camera > send), matching the web. */
    val primaryAction: AgentButtonAction
        get() = when {
            actions.contains(AgentButtonAction.Prefill) -> AgentButtonAction.Prefill
            actions.contains(AgentButtonAction.Camera) -> AgentButtonAction.Camera
            else -> AgentButtonAction.Send
        }
}

data class ParsedAgentMessage(val prose: String, val buttons: List<AgentButton>)

object AgentMessageParser {
    private val buttonsBlock = Regex("\\[buttons\\]([\\s\\S]*?)\\[/buttons\\]", RegexOption.IGNORE_CASE)
    private val imgToken = Regex("\\[img:[^\\]]+\\]", RegexOption.IGNORE_CASE)
    private val actionsShape = Regex("^[a-z, ]+$", RegexOption.IGNORE_CASE)
    private val cameraWords = Regex("\\b(scan|photo|video|camera|snap|picture|image)\\b", RegexOption.IGNORE_CASE)
    private val nonAlpha = Regex("[^a-z]")

    fun parse(content: String): ParsedAgentMessage =
        ParsedAgentMessage(prose = prose(content), buttons = buttons(content))

    fun buttons(content: String): List<AgentButton> {
        val inner = buttonsBlock.find(content)?.groupValues?.getOrNull(1) ?: return emptyList()
        return inner.split("\n").mapNotNull { rawLine ->
            val line = rawLine.trim()
            if (!line.contains("|")) return@mapNotNull null
            val parts = line.split("|")
            val label = parts[0].trim()
            val lastPart = parts.last().trim()
            val looksLikeActions = parts.size >= 3 &&
                lastPart.length < 30 &&
                actionsShape.matches(lastPart)

            val messageParts = if (looksLikeActions) parts.subList(1, parts.size - 1) else parts.subList(1, parts.size)
            val message = messageParts.joinToString("|").trim()
            val explicit = if (looksLikeActions) parseActions(lastPart) else emptyList()
            val actions = explicit.ifEmpty { inferActions(message) }

            if (label.isEmpty() || message.isEmpty()) null
            else AgentButton(label = label, message = message, actions = actions)
        }
    }

    private fun parseActions(raw: String): List<AgentButtonAction> =
        raw.lowercase().split(',', ' ').mapNotNull { token ->
            when (nonAlpha.replace(token, "")) {
                "send" -> AgentButtonAction.Send
                "prefill" -> AgentButtonAction.Prefill
                "camera" -> AgentButtonAction.Camera
                else -> null
            }
        }

    private fun inferActions(message: String): List<AgentButtonAction> {
        if (cameraWords.containsMatchIn(message)) return listOf(AgentButtonAction.Camera)
        if (message.trim().endsWith(":")) return listOf(AgentButtonAction.Prefill)
        return listOf(AgentButtonAction.Send)
    }

    fun prose(content: String): String {
        var s = content
        s = buttonsBlock.replace(s, "")
        s = imgToken.replace(s, "")
        return s.trim()
    }
}
