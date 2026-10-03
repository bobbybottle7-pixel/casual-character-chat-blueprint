package app.camai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Optional "Cloud boost": big models through OpenRouter (OpenAI-compatible API).
 * Requests go straight from the phone to OpenRouter with the user's own key.
 */
object CloudEngine {
    private const val BASE = "https://openrouter.ai/api/v1"
    private val json = Json { ignoreUnknownKeys = true }

    @Volatile private var active: HttpURLConnection? = null
    @Volatile private var stopped = false

    /** Free chat models currently offered by OpenRouter. */
    suspend fun freeModels(): List<String> = withContext(Dispatchers.IO) {
        val conn = URL("$BASE/models").openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        val root = json.parseToJsonElement(conn.inputStream.bufferedReader().use { it.readText() }).jsonObject
        root["data"]!!.jsonArray.mapNotNull { m ->
            val o = m.jsonObject
            val id = o["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val outputs = (o["architecture"] as? JsonObject)?.get("output_modalities") as? JsonArray
            val textOut = outputs == null || outputs.any { it.jsonPrimitive.contentOrNull == "text" }
            if (textOut && (id.endsWith(":free") || id == "openrouter/free")) id else null
        }.sortedWith(compareBy({ it != "openrouter/free" }, { it }))
    }

    fun stop() {
        stopped = true
        runCatching { active?.disconnect() }
    }

    /**
     * Streams a reply. Reasoning (if the model sends any) is wrapped in <think></think>
     * so the UI shows it the same way as for local models. Returns "" or an error message.
     */
    suspend fun generate(
        key: String,
        model: String,
        messages: List<Pair<String, String>>,
        temperature: Float,
        maxTokens: Int,
        onText: (String) -> Boolean,
    ): String = withContext(Dispatchers.IO) {
        stopped = false
        val body = buildJsonObject {
            put("model", model)
            put("stream", true)
            put("temperature", temperature)
            put("max_tokens", maxTokens)
            putJsonArray("messages") {
                messages.forEach { (role, content) -> addJsonObject { put("role", role); put("content", content) } }
            }
        }
        val conn = URL("$BASE/chat/completions").openConnection() as HttpURLConnection
        active = conn
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 20000
            conn.readTimeout = 120000
            conn.setRequestProperty("Authorization", "Bearer $key")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-Title", "CamAI")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }

            val code = conn.responseCode
            if (code !in 200..299) {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val msg = runCatching {
                    json.parseToJsonElement(err).jsonObject["error"]!!.jsonObject["message"]!!.jsonPrimitive.content
                }.getOrDefault(err.take(300))
                return@withContext when (code) {
                    401 -> "Cloud key was rejected. Check your OpenRouter key in Settings."
                    429 -> "The free cloud model is busy (rate limit). Wait a minute or pick another model in Settings."
                    else -> "Cloud error $code: $msg"
                }
            }

            var inReasoning = false
            conn.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    if (stopped) break
                    if (!line.startsWith("data:")) continue
                    val data = line.removePrefix("data:").trim()
                    if (data == "[DONE]") break
                    val obj = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: continue
                    obj["error"]?.let { e ->
                        val m = (e as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull ?: e.toString()
                        return@withContext "Cloud error: $m"
                    }
                    val delta = obj["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("delta") as? JsonObject ?: continue
                    val reasoning = (delta["reasoning"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    val content = (delta["content"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    var piece = ""
                    if (reasoning.isNotEmpty()) {
                        if (!inReasoning) { piece += "<think>"; inReasoning = true }
                        piece += reasoning
                    }
                    if (content.isNotEmpty()) {
                        if (inReasoning) { piece += "</think>"; inReasoning = false }
                        piece += content
                    }
                    if (piece.isNotEmpty() && !onText(piece)) break
                }
            }
            if (inReasoning) onText("</think>")
            ""
        } catch (e: IOException) {
            if (stopped) "" else "Could not reach the cloud: ${e.message ?: "network error"}. Check your internet connection."
        } finally {
            active = null
            runCatching { conn.disconnect() }
        }
    }
}
