package app.camai

import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

data class CatalogModel(
    val name: String,
    val file: String,
    val url: String,
    val sizeMb: Int,
    val blurb: String,
    val tier: String,
    val canThink: Boolean = false,
)

private const val HF = "https://huggingface.co"

/** Models picked for phones with ~4 GB of RAM. Q4_0 files get Arm-optimised kernels in llama.cpp. */
val CATALOG = listOf(
    CatalogModel(
        "LFM 2.5 350M", "LFM2.5-350M-Q4_0.gguf",
        "$HF/LiquidAI/LFM2.5-350M-GGUF/resolve/main/LFM2.5-350M-Q4_0.gguf",
        219, "Instant replies, but very basic answers.", "Tiny",
    ),
    CatalogModel(
        "Qwen 3.5 0.8B", "Qwen3.5-0.8B-Q4_0.gguf",
        "$HF/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf",
        507, "Fast and small. Can think before answering.", "Small", canThink = true,
    ),
    CatalogModel(
        "LFM 2.5 1.2B", "LFM2.5-1.2B-Instruct-Q4_0.gguf",
        "$HF/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_0.gguf",
        696, "Built for phones: the best balance of speed and smarts. Start here.", "Recommended",
    ),
    CatalogModel(
        "Qwen 3.5 2B", "Qwen3.5-2B-Q4_0.gguf",
        "$HF/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_0.gguf",
        1215, "Noticeably smarter, good at coding and reasoning. Slower.", "Smart", canThink = true,
    ),
    CatalogModel(
        "LFM 2.5 2.6B", "LFM2.5-2.6B-Q4_0.gguf",
        "$HF/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_0.gguf",
        1594, "The smartest model that should fit a 4 GB phone.", "Smarter",
    ),
    CatalogModel(
        "Qwen 3.5 4B", "Qwen3.5-4B-Q4_0.gguf",
        "$HF/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_0.gguf",
        2583, "Experimental on 4 GB phones: may be very slow or get closed by Android.", "Experimental", canThink = true,
    ),
)

data class DownloadState(val running: Boolean, val doneBytes: Long, val totalBytes: Long, val failed: Boolean)

class ModelManager(private val context: Context) {
    val dir: File = File(context.getExternalFilesDir(null) ?: context.filesDir, "models").apply { mkdirs() }
    private val dm = context.getSystemService(DownloadManager::class.java)
    private val prefs = context.getSharedPreferences("downloads", Context.MODE_PRIVATE)

    fun fileFor(m: CatalogModel) = File(dir, m.file)
    fun isReady(file: File) = file.exists() && file.length() > 0

    fun localModels(): List<File> =
        (dir.listFiles { f -> f.name.endsWith(".gguf") } ?: emptyArray()).sortedBy { it.name.lowercase() }

    fun displayName(path: String): String {
        val name = File(path).name
        return CATALOG.firstOrNull { it.file == name }?.name ?: name.removeSuffix(".gguf")
    }

    fun startDownload(m: CatalogModel) = startDownload(m.name, m.file, m.url, m.sizeMb)

    fun startDownload(name: String, file: String, url: String, sizeMb: Int) {
        File(dir, "$file.part").delete()
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("CamAI: $name")
            .setDescription("Downloading AI model ($sizeMb MB)")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, null, "models/$file.part")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
        prefs.edit().putLong(file, dm.enqueue(req)).apply()
    }

    fun pendingDownloads(): List<String> = prefs.all.keys.toList()

    /** Current state of a download, finishing it (rename .part) when complete. */
    fun poll(file: String): DownloadState? {
        val id = prefs.getLong(file, -1)
        if (id < 0) return null
        dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
            if (!c.moveToFirst()) {
                prefs.edit().remove(file).apply()
                return DownloadState(false, 0, 0, failed = true)
            }
            val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    prefs.edit().remove(file).apply()
                    val part = File(dir, "$file.part")
                    val target = File(dir, file)
                    if (part.exists()) part.renameTo(target)
                    DownloadState(false, done, total, failed = !target.exists())
                }
                DownloadManager.STATUS_FAILED -> {
                    prefs.edit().remove(file).apply()
                    dm.remove(id)
                    DownloadState(false, done, total, failed = true)
                }
                else -> DownloadState(true, done, total, failed = false)
            }
        }
    }

    fun cancel(file: String) {
        val id = prefs.getLong(file, -1)
        if (id >= 0) dm.remove(id)
        prefs.edit().remove(file).apply()
        File(dir, "$file.part").delete()
    }

    fun delete(file: File) = file.delete()

    /** Copies a .gguf file the user picked into the models folder. */
    suspend fun import(uri: Uri, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var name = "imported-model.gguf"
        var size = -1L
        resolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = c.getLong(it) }
            }
        }
        require(name.lowercase().endsWith(".gguf")) { "That isn't a .gguf model file." }
        val part = File(dir, "$name.part")
        resolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Could not open the file." }
            part.outputStream().use { out ->
                val buf = ByteArray(1 shl 20)
                var copied = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    copied += n
                    if (size > 0) onProgress(copied.toFloat() / size)
                }
            }
        }
        val target = File(dir, name)
        part.renameTo(target)
        target
    }

    fun totalRamMb(): Long {
        val mi = ActivityManager.MemoryInfo()
        context.getSystemService(ActivityManager::class.java).getMemoryInfo(mi)
        return mi.totalMem / (1024 * 1024)
    }

    fun availRamMb(): Long {
        val mi = ActivityManager.MemoryInfo()
        context.getSystemService(ActivityManager::class.java).getMemoryInfo(mi)
        return mi.availMem / (1024 * 1024)
    }

    fun freeStorageMb(): Long = StatFs(dir.path).availableBytes / (1024 * 1024)
}
