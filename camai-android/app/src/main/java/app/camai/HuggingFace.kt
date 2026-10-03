package app.camai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class HfRepo(val id: String, val downloads: Long, val likes: Long)

data class HfFile(val repo: String, val name: String, val sizeBytes: Long) {
    val sizeMb get() = sizeBytes / (1024 * 1024)
    val url get() = "https://huggingface.co/$repo/resolve/main/" + name.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
    val fileName get() = name.substringAfterLast('/')
    val quant get() = HuggingFace.quantOf(name)
}

/** Model Finder: searches Hugging Face for GGUF models (public API, no account needed). */
object HuggingFace {
    private val json = Json { ignoreUnknownKeys = true }
    private val quantRegex = Regex("(?i)(IQ\\d_[A-Z]+|Q\\d_K(?:_[SML])?|Q\\d_\\d|Q\\d_K|BF16|F16|F32|MXFP4)")
    private val splitPart = Regex("-\\d{5}-of-\\d{5}\\.gguf$")

    fun quantOf(name: String): String = quantRegex.find(name)?.value?.uppercase() ?: ""

    fun parseSearch(body: String): List<HfRepo> =
        json.parseToJsonElement(body).jsonArray.mapNotNull { el ->
            val o = el.jsonObject
            val id = o["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            HfRepo(id, o["downloads"]?.jsonPrimitive?.longOrNull ?: 0, o["likes"]?.jsonPrimitive?.longOrNull ?: 0)
        }

    /** Returns (gated, files). Leaves out vision projectors and multi-part files the app can't use. */
    fun parseFiles(repo: String, body: String): Pair<Boolean, List<HfFile>> {
        val o = json.parseToJsonElement(body).jsonObject
        val gatedEl = o["gated"] as? JsonPrimitive
        val gated = gatedEl != null && gatedEl.booleanOrNull != false && gatedEl.contentOrNull != "false"
        val files = o["siblings"]?.jsonArray.orEmpty().mapNotNull { s ->
            val so = s as? JsonObject ?: return@mapNotNull null
            val name = so["rfilename"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val size = so["size"]?.jsonPrimitive?.longOrNull ?: 0
            val lower = name.lowercase()
            if (!lower.endsWith(".gguf") || "mmproj" in lower || splitPart.containsMatchIn(lower) || size <= 0) null
            else HfFile(repo, name, size)
        }.sortedBy { it.sizeBytes }
        return gated to files
    }

    suspend fun search(query: String): List<HfRepo> = withContext(Dispatchers.IO) {
        val q = URLEncoder.encode(query.trim(), "UTF-8")
        parseSearch(get("https://huggingface.co/api/models?search=$q&filter=gguf&sort=downloads&direction=-1&limit=40"))
    }

    suspend fun files(repo: String): Pair<Boolean, List<HfFile>> = withContext(Dispatchers.IO) {
        parseFiles(repo, get("https://huggingface.co/api/models/$repo?blobs=true"))
    }

    private fun get(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        try {
            if (conn.responseCode !in 200..299) error("Hugging Face returned ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}
