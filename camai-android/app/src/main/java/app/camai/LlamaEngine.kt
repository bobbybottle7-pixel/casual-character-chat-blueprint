package app.camai

import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

/**
 * Kotlin side of the native llama.cpp engine (app/src/main/cpp).
 * Every call runs on one dedicated thread; only [stop] is called from elsewhere.
 * Text crosses JNI as UTF-8 bytes so emoji survive.
 */
object LlamaEngine {
    interface TextListener {
        fun onText(utf8: ByteArray): Boolean
    }

    private val dispatcher = Executors.newSingleThreadExecutor { r ->
        Thread(r, "camai-engine").apply { priority = Thread.MAX_PRIORITY }
    }.asCoroutineDispatcher()

    @Volatile private var initialized = false
    @Volatile var loadedPath: String? = null
        private set

    private external fun nativeInit(libDir: ByteArray)
    private external fun nativeLoad(path: ByteArray, nCtx: Int, nThreads: Int, kvQ8: Boolean, nBatch: Int): ByteArray
    private external fun nativePlan(path: ByteArray, ctxSizes: IntArray): ByteArray
    private external fun nativeSaveSession(path: ByteArray): Boolean
    private external fun nativeLoadSession(path: ByteArray): Boolean
    private external fun nativeUnload()
    private external fun nativeInfo(): ByteArray
    private external fun nativeSetThreads(n: Int)
    private external fun nativeStop()
    private external fun nativeBench(threads: IntArray, nTokens: Int): ByteArray
    private external fun nativeGenerate(
        roles: Array<ByteArray>, contents: Array<ByteArray>,
        temp: Float, topP: Float, topK: Int, minP: Float, repeatPenalty: Float,
        maxTokens: Int, thinking: Boolean, listener: TextListener,
    ): ByteArray

    /** Loads the native libraries. Throws if the phone cannot run them. */
    suspend fun init(nativeLibDir: String) = withContext(dispatcher) {
        if (!initialized) {
            System.loadLibrary("camai")
            nativeInit(nativeLibDir.toByteArray())
            initialized = true
        }
    }

    /** Returns null on success, otherwise a readable error. */
    suspend fun load(path: String, nCtx: Int, nThreads: Int, kvQ8: Boolean = false, nBatch: Int = 256): String? = withContext(dispatcher) {
        loadedPath = null
        val err = nativeLoad(path.toByteArray(), nCtx, nThreads, kvQ8, nBatch).decode()
        if (err.isEmpty()) {
            loadedPath = path
            null
        } else {
            err
        }
    }

    suspend fun unload() = withContext(dispatcher) {
        if (initialized) nativeUnload()
        loadedPath = null
    }

    suspend fun info(): String = withContext(dispatcher) { if (initialized) nativeInfo().decode() else "{}" }

    suspend fun setThreads(n: Int) = withContext(dispatcher) { if (initialized) nativeSetThreads(n) }

    suspend fun bench(threads: IntArray, nTokens: Int): String = withContext(dispatcher) {
        nativeBench(threads, nTokens).decode()
    }

    /** Smart Fit: simulated memory use (JSON) for each context size, without reading the weights. */
    suspend fun plan(path: String, ctxSizes: IntArray): String = withContext(dispatcher) {
        nativePlan(path.toByteArray(), ctxSizes).decode()
    }

    /** Instant Resume: write/restore the current conversation state. */
    suspend fun saveSession(path: String): Boolean = withContext(dispatcher) {
        loadedPath != null && nativeSaveSession(path.toByteArray())
    }

    suspend fun loadSession(path: String): Boolean = withContext(dispatcher) {
        loadedPath != null && nativeLoadSession(path.toByteArray())
    }

    /** Thread-safe: makes the running generation stop after the current word. */
    fun stop() {
        if (initialized) nativeStop()
    }

    /** Streams the reply through [onText] (return false to stop) and returns the stats JSON. */
    suspend fun generate(
        messages: List<Pair<String, String>>,
        temperature: Float,
        maxTokens: Int,
        thinking: Boolean,
        onText: (String) -> Boolean,
    ): String = withContext(dispatcher) {
        nativeGenerate(
            messages.map { it.first.toByteArray() }.toTypedArray(),
            messages.map { it.second.toByteArray() }.toTypedArray(),
            temperature, 0.9f, 40, 0.05f, 1.1f, maxTokens, thinking,
            object : TextListener {
                override fun onText(utf8: ByteArray) = onText(utf8.decode())
            },
        ).decode()
    }

    private fun ByteArray.decode() = String(this, Charsets.UTF_8)
}
