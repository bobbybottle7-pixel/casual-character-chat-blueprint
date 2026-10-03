package app.camai

import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Remembers why the app last closed unexpectedly so the next launch can explain it.
 * - Kotlin crashes: the stack trace is saved by an uncaught-exception handler.
 * - Native crashes / Android killing the app for memory (no handler runs): detected via
 *   marker files written before loading a model or generating, and removed afterwards.
 */
object CrashGuard {
    private const val CRASH = "crash.txt"
    private const val LOADING = "marker-loading"
    private const val GENERATING = "marker-generating"

    /** True when the previous run died while loading a model: skip auto-load once. */
    var lastLoadCrashed = false
        private set

    fun install(context: Context) {
        val dir = context.filesDir
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching {
                val sw = StringWriter()
                e.printStackTrace(PrintWriter(sw))
                File(dir, CRASH).writeText(
                    "CamAI ${BuildConfigInfo.version} crashed on ${Build.MANUFACTURER} ${Build.MODEL} " +
                        "(Android ${Build.VERSION.RELEASE}, thread ${thread.name}):\n\n$sw",
                )
            }
            previous?.uncaughtException(thread, e)
        }
    }

    fun mark(context: Context, what: String, detail: String) {
        runCatching { File(context.filesDir, if (what == "loading") LOADING else GENERATING).writeText(detail) }
    }

    fun clear(context: Context, what: String) {
        File(context.filesDir, if (what == "loading") LOADING else GENERATING).delete()
    }

    /** Returns a report about the last unexpected exit (and forgets it), or null. */
    fun consumeReport(context: Context): String? {
        val dir = context.filesDir
        val parts = mutableListOf<String>()
        File(dir, LOADING).takeIf { it.exists() }?.let {
            lastLoadCrashed = true
            parts += "CamAI closed while loading the model \"${it.readText()}\". This usually means the phone ran out of memory. " +
                "Try a smaller model, or a smaller context size in Settings. (Auto-load was skipped this time.)"
            it.delete()
        }
        File(dir, GENERATING).takeIf { it.exists() }?.let {
            parts += "CamAI closed while writing a reply with \"${it.readText()}\" (probably out of memory). " +
                "Try a smaller model or context size, and close other apps."
            it.delete()
        }
        File(dir, CRASH).takeIf { it.exists() }?.let {
            parts += it.readText()
            it.delete()
        }
        return parts.takeIf { it.isNotEmpty() }?.joinToString("\n\n")
    }
}

object BuildConfigInfo {
    const val version = "2.0.0"
}
