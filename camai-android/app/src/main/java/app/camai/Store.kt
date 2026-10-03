package app.camai

import android.content.Context
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/** Saves chats, characters and settings as JSON files in the app's private storage. */
class Store(context: Context) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val root = context.filesDir
    private val chatsDir = File(root, "chats").apply { mkdirs() }
    private val settingsFile = File(root, "settings.json")
    private val charactersFile = File(root, "characters.json")

    fun loadSettings(): Settings = read(settingsFile) { json.decodeFromString<Settings>(it) } ?: Settings()
    fun saveSettings(s: Settings) = write(settingsFile, json.encodeToString(s))

    fun loadCharacters(): List<Character> =
        read(charactersFile) { json.decodeFromString<List<Character>>(it) } ?: emptyList()
    fun saveCharacters(list: List<Character>) = write(charactersFile, json.encodeToString(list))

    fun loadChats(): List<Chat> =
        (chatsDir.listFiles { f -> f.name.endsWith(".json") } ?: emptyArray())
            .mapNotNull { f -> read(f) { json.decodeFromString<Chat>(it) } }
            .sortedByDescending { it.updatedAt }

    fun saveChat(chat: Chat) = write(File(chatsDir, "${chat.id}.json"), json.encodeToString(chat))
    fun deleteChat(id: String) { File(chatsDir, "$id.json").delete() }

    fun exportChat(chat: Chat): String = json.encodeToString(chat)

    private fun <T> read(file: File, parse: (String) -> T): T? =
        if (file.exists()) runCatching { parse(file.readText()) }.getOrNull() else null

    // Write to a temp file then rename, so a crash mid-write never corrupts a chat.
    @Synchronized
    private fun write(file: File, text: String) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.writeText(text)
            tmp.delete()
        }
    }
}
