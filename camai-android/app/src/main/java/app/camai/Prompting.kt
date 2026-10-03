package app.camai

/** Pure text logic (no Android), covered by unit tests in src/test. */
object Prompting {

    fun systemPrompt(character: Character, settings: Settings): String {
        val user = settings.userName.trim()
        if (character.id == DEFAULT_CHARACTER_ID) {
            return settings.systemPrompt.trim() + if (user.isNotEmpty()) "\nThe user's name is $user." else ""
        }
        return buildString {
            append("You are ${character.name}. Stay in character as ${character.name} for the whole conversation and reply the way they would.")
            if (character.tagline.isNotBlank()) append("\nWho you are: ${character.tagline.trim()}")
            if (character.personality.isNotBlank()) append("\nPersonality: ${character.personality.trim()}")
            if (character.scenario.isNotBlank()) append("\nScenario: ${character.scenario.trim()}")
            if (user.isNotEmpty()) append("\nYou are talking with $user.")
            append("\nWrite natural, engaging replies. Never break character.")
        }
    }

    /**
     * The messages sent to a model: system prompt, then the chat with thoughts and failed
     * replies removed. Leading assistant messages (a character's greeting) are folded into the
     * system prompt, because many chat templates require the first turn to be the user's.
     */
    fun buildHistory(chat: Chat, character: Character, settings: Settings): List<Pair<String, String>> {
        val usable = chat.messages.filter { !it.error && it.content.isNotBlank() }
        val leading = usable.takeWhile { it.role == "assistant" }
        var system = systemPrompt(character, settings)
        if (leading.isNotEmpty()) {
            system += "\nYou opened the conversation with: \"" + leading.joinToString("\n") { splitThoughts(it.content).second } + "\""
        }
        return listOf("system" to system) + usable.drop(leading.size).map { it.role to splitThoughts(it.content).second }
    }

    /** Splits "<think>…</think>answer" into (thoughts, answer). Thoughts are null when absent. */
    fun splitThoughts(text: String): Pair<String?, String> {
        val open = text.indexOf("<think>")
        val close = text.indexOf("</think>")
        return when {
            open >= 0 && close > open ->
                text.substring(open + 7, close).trim() to (text.substring(0, open) + text.substring(close + 8)).trim()
            open >= 0 -> text.substring(open + 7).trim() to text.substring(0, open).trim()  // still thinking
            close >= 0 -> text.substring(0, close).trim() to text.substring(close + 8).trim()
            else -> null to text.trim()
        }
    }

    fun isStillThinking(text: String) = text.contains("<think>") && !text.contains("</think>")

    fun titleFrom(text: String): String {
        val line = text.trim().lineSequence().firstOrNull().orEmpty().trim()
        return if (line.length <= 40) line.ifEmpty { "New chat" } else line.take(38).trimEnd() + "…"
    }

    /** Human-readable speed line from the engine's stats JSON fields. */
    fun statsLine(genTokens: Int, genMs: Long, promptTokens: Int, reused: Int, promptMs: Long, model: String): String {
        val parts = mutableListOf<String>()
        if (genTokens > 0 && genMs > 0) parts += "%.1f tokens/s".format(genTokens * 1000.0 / genMs)
        val fresh = promptTokens - reused
        if (fresh > 0 && promptMs > 300) parts += "read ${fresh} in %.1fs".format(promptMs / 1000.0)
        parts += model
        return parts.joinToString(" · ")
    }

    /** Strips Markdown and thoughts so text-to-speech reads naturally. */
    fun plainForSpeech(text: String): String =
        splitThoughts(text).second
            .replace(Regex("```[\\s\\S]*?```"), " (code) ")
            .replace(Regex("[*_`#>]+"), "")
            .replace(Regex("\\[(.*?)]\\((.*?)\\)"), "$1")
            .replace(Regex("[ \\t]{2,}"), " ")
            .trim()
}
