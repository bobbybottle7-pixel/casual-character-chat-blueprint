package app.camai.ui

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.BuildConfigInfo
import app.camai.EngineState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiagnosticsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val context = LocalContext.current
    val report = diagnosticsText(vm)
    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                title = { Text("Diagnostics") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("If something goes wrong, copy this and send it to whoever is helping you.", color = Muted, fontSize = 13.sp)
            Row {
                Button(onClick = { copyToClipboard(context, report) }) { Text("Copy diagnostics") }
                if (vm.crashReport != null) TextButton(onClick = { vm.crashReport = null }) { Text("Clear crash report") }
            }
            SelectionContainer { Text(report, fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
        }
    }
}

fun diagnosticsText(vm: AppViewModel): String = buildString {
    appendLine("CamAI ${BuildConfigInfo.version}")
    appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.HARDWARE}), Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
    appendLine("CPU cores: ${Runtime.getRuntime().availableProcessors()}, ABIs: ${Build.SUPPORTED_ABIS.joinToString()}")
    appendLine("RAM: ${vm.models.totalRamMb()} MB total, ${vm.models.availRamMb()} MB free now")
    appendLine("Free storage: ${vm.models.freeStorageMb()} MB")
    appendLine("Engine: " + when (val e = vm.engine) {
        EngineState.Off -> "no model loaded"
        is EngineState.Loading -> "loading ${e.name}"
        is EngineState.Ready -> "ready: ${e.name}"
        is EngineState.Failed -> "failed: ${e.message}"
    })
    vm.nativeError?.let { appendLine("Native error: $it") }
    appendLine("Threads: ${vm.threadsToUse()} (setting: ${if (vm.settings.threads == 0) "auto" else vm.settings.threads})")
    appendLine("Context: ${vm.settings.contextSize}, max reply: ${vm.settings.maxTokens}, thinking: ${vm.settings.thinking}")
    appendLine("Smart Fit: ${vm.settings.smartFit}, compression: ${vm.settings.kvMode}, instant resume: ${vm.settings.instantResume}, budget ~${vm.budgetMb()} MB")
    vm.loadedConfig?.let { appendLine("Loaded with: ctx ${it.nCtx}, batch ${it.nBatch}, kv ${if (it.kvQ8) "q8" else "f16"}, planned ${it.totalMb} MB") }
    runCatching {
        val info = Json.parseToJsonElement(vm.modelInfo).jsonObject
        if (info.isNotEmpty()) {
            appendLine("Model info:")
            info.forEach { (k, v) -> appendLine("  $k: $v") }
        }
    }
    vm.benchResult?.let { appendLine("Speed test:\n$it") }
    vm.crashReport?.let { appendLine("\nLast unexpected exit:\n$it") }
}
