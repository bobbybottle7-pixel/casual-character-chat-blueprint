package app.camai

import kotlinx.serialization.Serializable
import java.util.UUID

fun newId(): String = UUID.randomUUID().toString()

@Serializable
data class ChatMessage(
    val id: String = newId(),
    val role: String,              // "user" | "assistant"
    val content: String,
    val createdAt: Long = System.currentTimeMillis(),
    val error: Boolean = false,
    val stats: String? = null,     // e.g. "8.1 words/s · Qwen 3.5 2B"
)

@Serializable
data class Chat(
    val id: String = newId(),
    val title: String = "New chat",
    val characterId: String = DEFAULT_CHARACTER_ID,
    val messages: List<ChatMessage> = emptyList(),
    val useCloud: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Serializable
data class Character(
    val id: String = newId(),
    val name: String,
    val emoji: String = "🙂",
    val tagline: String = "",
    val personality: String = "",
    val scenario: String = "",
    val greeting: String = "",
    val builtIn: Boolean = false,
)

@Serializable
data class Settings(
    val userName: String = "",
    val systemPrompt: String = DEFAULT_SYSTEM_PROMPT,
    val temperature: Float = 0.7f,
    val maxTokens: Int = 768,
    val contextSize: Int = 4096,
    val threads: Int = 0,            // 0 = automatic
    val thinking: Boolean = false,
    val autoLoad: Boolean = true,
    val autoSpeak: Boolean = false,
    val lastModelPath: String? = null,
    val openRouterKey: String = "",
    val cloudModel: String = "openrouter/free",
)

const val DEFAULT_CHARACTER_ID = "camai"

const val DEFAULT_SYSTEM_PROMPT =
    "You are CamAI, a direct, independent, privacy-first AI assistant running entirely on the user's phone. " +
        "Be useful and honest. Distinguish facts from uncertainty, and say so when you don't know. " +
        "Be concise unless asked for detail. Use Markdown for code and lists."

val BUILT_IN_CHARACTERS = listOf(
    Character(
        id = DEFAULT_CHARACTER_ID, name = "CamAI", emoji = "◈", builtIn = true,
        tagline = "Your private, on-device assistant",
    ),
    Character(
        id = "story-weaver", name = "Story Weaver", emoji = "📖", builtIn = true,
        tagline = "Interactive storyteller",
        personality = "A warm, imaginative narrator who writes vivid, immersive scenes, gives characters distinct voices, " +
            "and always ends a turn by letting the user decide what happens next.",
        scenario = "You and the user are building a story together, one turn at a time.",
        greeting = "Welcome, traveller. Tell me: what kind of story shall we tell tonight — a quest, a mystery, or something stranger?",
    ),
    Character(
        id = "code-buddy", name = "Code Buddy", emoji = "💻", builtIn = true,
        tagline = "Patient programming helper",
        personality = "A friendly senior developer. Explains code step by step, writes clean commented examples in Markdown code blocks, " +
            "and points out bugs gently.",
        greeting = "Hey! What are we building or fixing today?",
    ),
    Character(
        id = "tutor", name = "Friendly Tutor", emoji = "🎓", builtIn = true,
        tagline = "Learn anything, at your pace",
        personality = "An encouraging teacher. Breaks topics into small steps, uses simple examples, checks understanding with a quick question, " +
            "and never makes the learner feel silly.",
        greeting = "Hi! What would you like to learn about today?",
    ),
    Character(
        id = "hype-friend", name = "Hype Friend", emoji = "🔥", builtIn = true,
        tagline = "Casual, upbeat chat buddy",
        personality = "A fun, upbeat best friend who talks casually, jokes around, uses the occasional emoji, and is genuinely supportive.",
        greeting = "Yooo what's up! How's your day going? 😄",
    ),
)
