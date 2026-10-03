package app.camai

import android.app.Application
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

enum class Screen { CHAT, MODELS, FINDER, SETTINGS, CHARACTERS, EDIT_CHARACTER, DIAGNOSTICS }

sealed class EngineState {
    data object Off : EngineState()
    data class Loading(val name: String) : EngineState()
    data class Ready(val path: String, val name: String) : EngineState()
    data class Failed(val message: String) : EngineState()
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx = app.applicationContext
    private val store = Store(ctx)
    val models = ModelManager(ctx)
    private val main = Handler(Looper.getMainLooper())
    private val json = Json { ignoreUnknownKeys = true }

    var settings by mutableStateOf(store.loadSettings()); private set
    var chats by mutableStateOf(store.loadChats()); private set
    var customCharacters by mutableStateOf(store.loadCharacters()); private set
    var currentChatId by mutableStateOf(chats.firstOrNull()?.id); private set
    var screen by mutableStateOf(Screen.CHAT)
    var editingCharacter by mutableStateOf<Character?>(null); private set

    var engine by mutableStateOf<EngineState>(EngineState.Off); private set
    var nativeError by mutableStateOf<String?>(null); private set
    var modelInfo by mutableStateOf("{}"); private set
    var localModels by mutableStateOf(models.localModels()); private set
    var downloads by mutableStateOf<Map<String, DownloadState>>(emptyMap()); private set
    var importProgress by mutableStateOf<Float?>(null); private set

    var generating by mutableStateOf(false); private set
    var streamingChatId by mutableStateOf<String?>(null); private set
    var streamText by mutableStateOf(""); private set

    var cloudModels by mutableStateOf<List<String>>(emptyList()); private set
    var benchRunning by mutableStateOf(false); private set
    var benchResult by mutableStateOf<String?>(null); private set
    var crashReport by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var speakingId by mutableStateOf<String?>(null); private set

    // Smart Fit
    var fitPlans by mutableStateOf<Map<String, FitPlan?>>(emptyMap()); private set
    var loadedConfig by mutableStateOf<FitConfig?>(null); private set

    // Model Finder
    var finderQuery by mutableStateOf("")
    var finderResults by mutableStateOf<List<HfRepo>>(emptyList()); private set
    var finderRepo by mutableStateOf<String?>(null); private set
    var finderFiles by mutableStateOf<List<HfFile>>(emptyList()); private set
    var finderBusy by mutableStateOf(false); private set
    var finderError by mutableStateOf<String?>(null); private set

    // Instant Resume: which chat's conversation state currently sits in the engine
    private var engineChatId: String? = null
    private var engineModelPath: String? = null  // model the engine's state belongs to (survives the Loading state)
    private val sessionsDir = File(ctx.filesDir, "sessions").apply { mkdirs() }

    val characters: List<Character> get() = BUILT_IN_CHARACTERS + customCharacters
    val currentChat: Chat? get() = chats.firstOrNull { it.id == currentChatId }
    fun characterFor(chat: Chat?): Character =
        characters.firstOrNull { it.id == chat?.characterId } ?: BUILT_IN_CHARACTERS[0]

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pollJob: Job? = null

    init {
        crashReport = CrashGuard.consumeReport(ctx)
        viewModelScope.launch {
            try {
                LlamaEngine.init(ctx.applicationInfo.nativeLibraryDir)
            } catch (t: Throwable) {
                nativeError = "The on-device AI engine could not start on this phone: ${t.message}. Cloud mode still works."
            }
            val last = settings.lastModelPath
            if (nativeError == null && settings.autoLoad && !CrashGuard.lastLoadCrashed && last != null && File(last).exists()) {
                loadModel(last)
            }
        }
        if (models.pendingDownloads().isNotEmpty()) ensurePolling()
    }

    // ---------------------------------------------------------------- settings

    fun updateSettings(transform: (Settings) -> Settings) {
        val old = settings
        val new = transform(old)
        settings = new
        viewModelScope.launch(Dispatchers.IO) { store.saveSettings(new) }
        if (new.threads != old.threads && engine is EngineState.Ready) {
            viewModelScope.launch { LlamaEngine.setThreads(threadsToUse()) }
        }
        if (new.contextSize != old.contextSize || new.kvMode != old.kvMode) resetFitPlans()
    }

    fun autoThreads(): Int = (Runtime.getRuntime().availableProcessors() - 2).coerceIn(2, 4)
    fun threadsToUse(): Int = if (settings.threads > 0) settings.threads else autoThreads()

    // ---------------------------------------------------------------- models

    fun loadModel(path: String) {
        if (engine is EngineState.Loading || generating) return
        if (nativeError != null) { notice = nativeError; return }
        val name = models.displayName(path)
        val previous = engine as? EngineState.Ready
        engine = EngineState.Loading(name)
        viewModelScope.launch {
            saveCurrentSession()
            engineChatId = null
            if (previous != null) {
                // Unload first so the planner counts the memory it frees.
                LlamaEngine.unload()
                loadedConfig = null
                engineModelPath = null
            }
            val s = settings
            var config = FitConfig(s.contextSize, 256, s.kvMode == "on", 0)
            var fitNote = ""
            if (s.smartFit) {
                planFor(path, force = true)?.let { plan ->
                    config = plan.chosen
                    fitNote = when (plan.level) {
                        FitLevel.TOO_BIG -> " Warning: it probably needs more memory than is free (${plan.chosen.totalMb} MB vs ~${plan.budgetMb} MB), so it may be slow or close."
                        else -> " Smart Fit: ${plan.chosen.nCtx} memory" + (if (plan.chosen.kvQ8) ", compressed" else "") + "."
                    }
                }
            }
            CrashGuard.mark(ctx, "loading", name)
            val err = try {
                LlamaEngine.load(path, config.nCtx, threadsToUse(), config.kvQ8, config.nBatch)
            } catch (t: Throwable) {
                t.message ?: "Unknown error"
            }
            CrashGuard.clear(ctx, "loading")
            if (err == null) {
                engine = EngineState.Ready(path, name)
                loadedConfig = config
                engineModelPath = path
                modelInfo = LlamaEngine.info()
                updateSettings { it.copy(lastModelPath = path) }
                notice = "$name is ready.$fitNote"
            } else {
                engine = EngineState.Failed(err)
                notice = err
            }
        }
    }

    fun unloadModel() {
        if (generating) return
        viewModelScope.launch {
            saveCurrentSession()
            engineChatId = null
            loadedConfig = null
            engineModelPath = null
            LlamaEngine.unload()
            engine = EngineState.Off
            modelInfo = "{}"
        }
    }

    fun startDownload(m: CatalogModel) {
        if (models.freeStorageMb() < m.sizeMb + 200) {
            notice = "Not enough free storage for ${m.name} (needs ${m.sizeMb + 200} MB)."
            return
        }
        runCatching { models.startDownload(m) }
            .onSuccess { ensurePolling() }
            .onFailure { notice = "Could not start the download: ${it.message}" }
    }

    fun cancelDownload(file: String) {
        models.cancel(file)
        downloads = downloads - file
    }

    private fun ensurePolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (true) {
                val pending = models.pendingDownloads()
                if (pending.isEmpty()) break
                val now = mutableMapOf<String, DownloadState>()
                for (file in pending) {
                    val st = withContext(Dispatchers.IO) { models.poll(file) } ?: continue
                    if (st.running) {
                        now[file] = st
                    } else {
                        val name = models.displayName(file)
                        notice = if (st.failed) "Download of $name failed. Check your connection and try again."
                        else "$name downloaded. Tap Load to use it."
                        localModels = models.localModels()
                    }
                }
                downloads = now
                delay(1000)
            }
            downloads = emptyMap()
            localModels = models.localModels()
        }
    }

    fun importModel(uri: Uri) {
        if (importProgress != null) return
        importProgress = 0f
        viewModelScope.launch {
            try {
                val f = models.import(uri) { p -> main.post { importProgress = p } }
                localModels = models.localModels()
                notice = "Imported ${f.name}."
            } catch (t: Throwable) {
                notice = t.message ?: "Import failed."
            } finally {
                importProgress = null
            }
        }
    }

    fun deleteModel(file: File) {
        val ready = engine as? EngineState.Ready
        viewModelScope.launch {
            if (ready?.path == file.path) {
                if (generating) return@launch
                LlamaEngine.unload()
                engine = EngineState.Off
                engineChatId = null
                loadedConfig = null
                engineModelPath = null
            }
            sessionsDir.listFiles()?.filter { it.name.contains("__${file.name}__") }?.forEach { it.delete() }
            fitPlans = fitPlans - file.path
            models.delete(file)
            if (settings.lastModelPath == file.path) updateSettings { it.copy(lastModelPath = null) }
            localModels = models.localModels()
        }
    }

    /** Times a few thread counts on this phone and keeps the fastest. */
    fun runSpeedTest() {
        if (engine !is EngineState.Ready || generating || benchRunning) {
            notice = "Load a model first, then run the speed test."
            return
        }
        benchRunning = true
        benchResult = null
        viewModelScope.launch {
            try {
                val cores = Runtime.getRuntime().availableProcessors()
                val candidates = listOf(1, 2, 3, 4, 6, 8).filter { it <= cores }.toIntArray()
                val res = json.parseToJsonElement(LlamaEngine.bench(candidates, 12)).jsonObject
                val speeds = res.mapNotNull { (k, v) -> v.jsonPrimitive.doubleOrNull?.let { k.toInt() to it } }
                val best = speeds.maxByOrNull { it.second }
                if (best != null) {
                    updateSettings { it.copy(threads = best.first) }
                    LlamaEngine.setThreads(best.first)
                    benchResult = speeds.joinToString("\n") { (n, s) ->
                        "%d thread%s: %.1f tokens/s%s".format(n, if (n == 1) "" else "s", s, if (n == best.first) "  ← fastest, now used" else "")
                    }
                }
            } catch (t: Throwable) {
                benchResult = "Speed test failed: ${t.message}"
            } finally {
                benchRunning = false
            }
        }
    }

    fun loadCloudModels() {
        viewModelScope.launch {
            runCatching { CloudEngine.freeModels() }
                .onSuccess { cloudModels = it }
                .onFailure { notice = "Could not fetch the cloud model list: ${it.message}" }
        }
    }

    // ---------------------------------------------------------------- Smart Fit

    /** Simulates the model's memory needs and picks settings that fit (cached per model). */
    suspend fun planFor(path: String, force: Boolean = false): FitPlan? {
        if (!force && fitPlans.containsKey(path)) return fitPlans[path]
        if (nativeError != null) return null
        val plan = try {
            val configs = SmartFit.parse(LlamaEngine.plan(path, SmartFit.contextCandidates(settings.contextSize)))
            val loadedMb = if ((engine as? EngineState.Ready)?.path != null) loadedConfig?.totalMb?.toLong() ?: 0 else 0
            SmartFit.choose(configs, settings.contextSize, settings.kvMode, SmartFit.budgetMb(models.availRamMb(), models.totalRamMb(), loadedMb))
        } catch (t: Throwable) {
            null
        }
        fitPlans = fitPlans + (path to plan)
        return plan
    }

    fun checkFits() {
        if (nativeError != null) return
        viewModelScope.launch {
            localModels.filter { !fitPlans.containsKey(it.path) }.forEach { planFor(it.path) }
        }
    }

    /** Settings that change memory use invalidate the cached plans. */
    fun resetFitPlans() { fitPlans = emptyMap() }

    // ---------------------------------------------------------------- Model Finder

    fun searchModels(query: String = finderQuery) {
        finderQuery = query
        if (query.isBlank()) return
        finderBusy = true
        finderError = null
        finderRepo = null
        viewModelScope.launch {
            try {
                finderResults = HuggingFace.search(query)
                if (finderResults.isEmpty()) finderError = "No GGUF models found for \"$query\"."
            } catch (t: Throwable) {
                finderError = "Search failed: ${t.message}. Check your internet connection."
            } finally {
                finderBusy = false
            }
        }
    }

    fun openRepo(repo: String) {
        finderRepo = repo
        finderFiles = emptyList()
        finderBusy = true
        finderError = null
        viewModelScope.launch {
            try {
                val (gated, files) = HuggingFace.files(repo)
                finderFiles = files
                finderError = when {
                    gated -> "This model requires accepting a licence on huggingface.co, so CamAI can't download it directly. " +
                        "Look for a copy from another uploader (e.g. bartowski, unsloth, ggml-org)."
                    files.isEmpty() -> "No usable GGUF files in this repository."
                    else -> null
                }
            } catch (t: Throwable) {
                finderError = "Could not list files: ${t.message}"
            } finally {
                finderBusy = false
            }
        }
    }

    fun closeRepo() { finderRepo = null; finderFiles = emptyList(); finderError = null }

    fun budgetMb(): Long = SmartFit.budgetMb(
        models.availRamMb(), models.totalRamMb(),
        if (engine is EngineState.Ready) loadedConfig?.totalMb?.toLong() ?: 0 else 0,
    )

    fun downloadHf(f: HfFile) {
        if (models.freeStorageMb() < f.sizeMb + 200) {
            notice = "Not enough free storage (needs ${f.sizeMb + 200} MB)."
            return
        }
        runCatching { models.startDownload(f.fileName, f.fileName, f.url, f.sizeMb.toInt()) }
            .onSuccess { ensurePolling(); notice = "Downloading ${f.fileName}… It will appear under Models." }
            .onFailure { notice = "Could not start the download: ${it.message}" }
    }

    // ---------------------------------------------------------------- Instant Resume

    private fun sessionFile(chatId: String): File? {
        val path = engineModelPath ?: return null
        val cfg = loadedConfig ?: return null
        // The saved state only fits the exact model and memory layout it came from.
        return File(sessionsDir, "${chatId}__${File(path).name}__${cfg.nCtx}_${if (cfg.kvQ8) "q8" else "f16"}.bin")
    }

    private suspend fun saveCurrentSession() {
        val id = engineChatId ?: return
        if (!settings.instantResume || chats.none { it.id == id }) return
        val f = sessionFile(id) ?: return
        withContext(Dispatchers.IO) { f.delete(); File(f.path + ".ckpt").delete() }
        LlamaEngine.saveSession(f.path)
        pruneSessions()
    }

    /** Puts the chat's saved state into the engine if it isn't there already. */
    private suspend fun resumeSession(chatId: String) {
        if (engineChatId == chatId) return
        saveCurrentSession()
        engineChatId = chatId
        if (!settings.instantResume) return
        val f = sessionFile(chatId) ?: return
        if (withContext(Dispatchers.IO) { f.exists() }) LlamaEngine.loadSession(f.path)
    }

    private fun pruneSessions() {
        val files = sessionsDir.listFiles { f -> f.name.endsWith(".bin") }?.sortedByDescending { it.lastModified() } ?: return
        files.drop(12).forEach { it.delete(); File(it.path + ".ckpt").delete() }
    }

    /** Called when the app goes to the background: keep the current chat resumable. */
    fun onBackground() {
        if (generating || engine !is EngineState.Ready) return
        viewModelScope.launch { saveCurrentSession() }
    }

    // ---------------------------------------------------------------- chats

    fun openChat(id: String) {
        currentChatId = id
        screen = Screen.CHAT
    }

    fun newChat(characterId: String = DEFAULT_CHARACTER_ID) {
        val c = characters.firstOrNull { it.id == characterId } ?: BUILT_IN_CHARACTERS[0]
        val greeting = c.greeting.trim().replace("{{user}}", settings.userName.ifBlank { "you" })
        val chat = Chat(
            title = if (c.id == DEFAULT_CHARACTER_ID) "New chat" else c.name,
            characterId = c.id,
            messages = if (greeting.isNotEmpty()) listOf(ChatMessage(role = "assistant", content = greeting)) else emptyList(),
            useCloud = currentChat?.useCloud == true,
        )
        saveChat(chat)
        openChat(chat.id)
    }

    fun deleteChat(id: String) {
        if (generating && streamingChatId == id) stop()
        chats = chats.filterNot { it.id == id }
        if (engineChatId == id) engineChatId = null
        viewModelScope.launch(Dispatchers.IO) {
            store.deleteChat(id)
            sessionsDir.listFiles()?.filter { it.name.startsWith("${id}__") }?.forEach { it.delete() }
        }
        if (currentChatId == id) currentChatId = chats.firstOrNull()?.id
    }

    fun renameChat(id: String, title: String) {
        chats.firstOrNull { it.id == id }?.let { saveChat(it.copy(title = title.trim().ifEmpty { it.title })) }
    }

    fun toggleCloud() {
        val chat = currentChat ?: run { newChat(); currentChat } ?: return
        val on = !chat.useCloud
        saveChat(chat.copy(useCloud = on))
        if (on && settings.openRouterKey.isBlank()) notice = "Add your free OpenRouter key in Settings to use Cloud."
        else notice = if (on) "This chat now uses Cloud (${settings.cloudModel})." else "This chat now runs on your phone."
    }

    fun transcript(chat: Chat): String {
        val who = characterFor(chat).name
        return chat.messages.filter { !it.error }.joinToString("\n\n") {
            (if (it.role == "user") settings.userName.ifBlank { "Me" } else who) + ": " + Prompting.splitThoughts(it.content).second
        }
    }

    private fun saveChat(chat: Chat) {
        chats = listOf(chat) + chats.filterNot { it.id == chat.id }
        viewModelScope.launch(Dispatchers.IO) { store.saveChat(chat) }
    }

    // ---------------------------------------------------------------- generation

    fun send(text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty() || generating) return false
        if (currentChat == null) newChat()
        val chat = currentChat ?: return false
        if (!canGenerate(chat)) return false
        val firstUserMessage = chat.messages.none { it.role == "user" }
        val updated = chat.copy(
            messages = chat.messages + ChatMessage(role = "user", content = t),
            title = if (firstUserMessage && chat.characterId == DEFAULT_CHARACTER_ID) Prompting.titleFrom(t) else chat.title,
            updatedAt = System.currentTimeMillis(),
        )
        saveChat(updated)
        generateReply(updated)
        return true
    }

    fun regenerate() {
        val chat = currentChat ?: return
        if (generating || !canGenerate(chat)) return
        val msgs = if (chat.messages.lastOrNull()?.role == "assistant") chat.messages.dropLast(1) else chat.messages
        if (msgs.none { it.role == "user" }) return
        val updated = chat.copy(messages = msgs)
        saveChat(updated)
        generateReply(updated)
    }

    fun editAndResend(messageId: String, newText: String) {
        val chat = currentChat ?: return
        if (generating || newText.isBlank() || !canGenerate(chat)) return
        val idx = chat.messages.indexOfFirst { it.id == messageId }
        if (idx < 0) return
        val updated = chat.copy(
            messages = chat.messages.take(idx) + chat.messages[idx].copy(content = newText.trim()),
            updatedAt = System.currentTimeMillis(),
        )
        saveChat(updated)
        generateReply(updated)
    }

    fun stop() {
        LlamaEngine.stop()
        CloudEngine.stop()
    }

    private fun canGenerate(chat: Chat): Boolean {
        if (chat.useCloud) {
            if (settings.openRouterKey.isBlank()) {
                notice = "Add your free OpenRouter key in Settings to use Cloud."
                return false
            }
            return true
        }
        return when (engine) {
            is EngineState.Ready -> true
            is EngineState.Loading -> { notice = "The model is still loading. One moment…"; false }
            else -> { notice = "No model loaded. Open Models to download or load one, or switch this chat to Cloud."; false }
        }
    }

    private fun generateReply(chat: Chat) {
        val history = Prompting.buildHistory(chat, characterFor(chat), settings)
        val s = settings
        val buffer = StringBuilder()
        val repaintQueued = AtomicBoolean(false)
        val onText: (String) -> Boolean = { piece ->
            synchronized(buffer) { buffer.append(piece) }
            if (repaintQueued.compareAndSet(false, true)) {
                main.postDelayed({
                    repaintQueued.set(false)
                    if (streamingChatId == chat.id) streamText = synchronized(buffer) { buffer.toString() }
                }, 60)
            }
            true
        }
        generating = true
        streamingChatId = chat.id
        streamText = ""
        viewModelScope.launch {
            var error = false
            var stats: String? = null
            val modelName = (engine as? EngineState.Ready)?.name ?: "model"
            CrashGuard.mark(ctx, "generating", if (chat.useCloud) "Cloud" else modelName)
            try {
                if (chat.useCloud) {
                    val err = CloudEngine.generate(s.openRouterKey, s.cloudModel, history, s.temperature, s.maxTokens, onText)
                    if (err.isNotEmpty()) {
                        synchronized(buffer) {
                            if (buffer.isBlank()) { buffer.append(err); error = true } else buffer.append("\n\n⚠️ ").append(err)
                        }
                    }
                    stats = "Cloud · ${s.cloudModel}"
                } else {
                    resumeSession(chat.id)
                    val res = json.parseToJsonElement(
                        LlamaEngine.generate(history, s.temperature, s.maxTokens, s.thinking, onText),
                    ).jsonObject
                    val errMsg = res["error"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    val reason = res["stop_reason"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    if (errMsg.isNotEmpty()) {
                        synchronized(buffer) {
                            if (buffer.isBlank()) { buffer.append(errMsg); error = true } else buffer.append("\n\n⚠️ ").append(errMsg)
                        }
                    }
                    fun int(k: String) = res[k]?.jsonPrimitive?.intOrNull ?: 0
                    fun long(k: String) = res[k]?.jsonPrimitive?.longOrNull ?: 0L
                    stats = Prompting.statsLine(int("gen_tokens"), long("gen_ms"), int("prompt_tokens"), int("reused_tokens"), long("prompt_ms"), modelName) +
                        (if (int("dropped_messages") > 0) " · oldest messages left out to fit memory" else "") +
                        (if (reason == "length") " · reached reply length limit" else "") +
                        (if (reason == "stopped") " · stopped" else "")
                }
            } catch (t: Throwable) {
                synchronized(buffer) { buffer.append("\n\nError: ${t.message}") }
                error = true
            } finally {
                CrashGuard.clear(ctx, "generating")
            }
            var text = synchronized(buffer) { buffer.toString() }.trim()
            if (text.isEmpty()) { text = "[No reply. Try again.]"; error = true }
            val reply = ChatMessage(role = "assistant", content = text, error = error, stats = stats)
            val latest = chats.firstOrNull { it.id == chat.id }
            if (latest != null) saveChat(latest.copy(messages = latest.messages + reply, updatedAt = System.currentTimeMillis()))
            generating = false
            streamingChatId = null
            streamText = ""
            if (s.autoSpeak && !error) speak(reply)
        }
    }

    // ---------------------------------------------------------------- characters

    fun editCharacter(c: Character?) {
        editingCharacter = c ?: Character(name = "", emoji = "🙂")
        screen = Screen.EDIT_CHARACTER
    }

    fun saveCharacter(c: Character) {
        val list = customCharacters.filterNot { it.id == c.id } + c.copy(builtIn = false)
        customCharacters = list
        viewModelScope.launch(Dispatchers.IO) { store.saveCharacters(list) }
        screen = Screen.CHARACTERS
    }

    fun deleteCharacter(id: String) {
        val list = customCharacters.filterNot { it.id == id }
        customCharacters = list
        viewModelScope.launch(Dispatchers.IO) { store.saveCharacters(list) }
        screen = Screen.CHARACTERS
    }

    // ---------------------------------------------------------------- voice output

    fun speak(m: ChatMessage) {
        if (speakingId == m.id) {
            tts?.stop()
            speakingId = null
            return
        }
        val text = Prompting.plainForSpeech(m.content)
        if (text.isBlank()) return
        val engineTts = tts
        if (engineTts != null && ttsReady) {
            say(engineTts, m.id, text)
            return
        }
        tts = TextToSpeech(ctx) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            val t = tts
            if (ttsReady && t != null) say(t, m.id, text) else notice = "Text-to-speech isn't available on this phone."
        }
    }

    private fun say(t: TextToSpeech, id: String, text: String) {
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
                if (utteranceId == "$id-last") main.post { if (speakingId == id) speakingId = null }
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                main.post { if (speakingId == id) speakingId = null }
            }
        })
        speakingId = id
        // Speech engines limit input length, so speak long replies in sentence-sized chunks.
        val chunks = text.split(Regex("(?<=[.!?])\\s+")).fold(mutableListOf<String>()) { acc, s ->
            if (acc.isNotEmpty() && acc.last().length + s.length < 3000) acc[acc.size - 1] = acc.last() + " " + s else acc += s
            acc
        }
        chunks.forEachIndexed { i, chunk ->
            val uid = if (i == chunks.lastIndex) "$id-last" else "$id-$i"
            t.speak(chunk.take(3900), if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, uid)
        }
    }

    override fun onCleared() {
        tts?.shutdown()
        super.onCleared()
    }
}
