package app.camai.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.CATALOG
import app.camai.CatalogModel
import app.camai.EngineState
import app.camai.FitLevel
import app.camai.Screen
import app.camai.SmartFit
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelsScreen(vm: AppViewModel, onBack: () -> Unit) {
    var confirmDelete by remember { mutableStateOf<File?>(null) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importModel(uri)
    }
    val totalRam = remember { vm.models.totalRamMb() }
    val ready = vm.engine as? EngineState.Ready
    LaunchedEffect(vm.localModels, vm.settings.contextSize, vm.settings.kvMode) { vm.checkFits() }

    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                title = { Text("Models") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Panel2)) {
                    Column(Modifier.padding(14.dp)) {
                        Text(
                            "Phone memory: %.1f GB  ·  Free storage: %.1f GB".format(totalRam / 1024.0, vm.models.freeStorageMb() / 1024.0),
                            color = Muted, fontSize = 13.sp,
                        )
                        Spacer(Modifier.padding(3.dp))
                        when (val e = vm.engine) {
                            is EngineState.Ready -> {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Loaded: ${e.name}", color = Good, modifier = Modifier.weight(1f))
                                    TextButton(onClick = { vm.unloadModel() }, enabled = !vm.generating) { Text("Unload") }
                                }
                                vm.loadedConfig?.let { c ->
                                    Text(
                                        "Memory: ${c.nCtx} tokens" + (if (c.kvQ8) " (compressed)" else "") + (if (c.totalMb > 0) " · ~${c.totalMb} MB" else ""),
                                        color = Muted, fontSize = 12.sp,
                                    )
                                }
                            }
                            is EngineState.Loading -> Text("Loading ${e.name}…", color = Warn)
                            is EngineState.Failed -> Text(e.message, color = Bad)
                            EngineState.Off -> Text("No model loaded. Download one below, then tap Load.", color = Muted)
                        }
                        vm.nativeError?.let { Text(it, color = Bad, fontSize = 13.sp) }
                    }
                }
            }
            item {
                OutlinedButton(onClick = { vm.screen = Screen.FINDER }, modifier = Modifier.fillMaxWidth()) {
                    Text("🔎  Find more models on Hugging Face")
                }
            }
            items(CATALOG, key = { it.file }) { m ->
                ModelCard(vm, m, totalRam, ready?.path) { confirmDelete = it }
            }
            item {
                Text("Your own models", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                Text(
                    "Any chat model in GGUF format works (e.g. from huggingface.co). Q4_0 files run fastest on phones.",
                    color = Muted, fontSize = 13.sp,
                )
                Spacer(Modifier.padding(4.dp))
                val p = vm.importProgress
                if (p != null) {
                    LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth())
                    Text("Importing… ${(p * 100).toInt()}%", color = Muted, fontSize = 12.sp)
                } else {
                    OutlinedButton(onClick = { importer.launch(arrayOf("*/*")) }) { Text("Import a .gguf file from this phone") }
                }
            }
            val catalogFiles = CATALOG.map { it.file }.toSet()
            items(vm.localModels.filter { it.name !in catalogFiles }, key = { it.path }) { f ->
                Surface(color = Panel, shape = RoundedCornerShape(12.dp)) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(f.name, maxLines = 2)
                            Text("${f.length() / (1024 * 1024)} MB", color = Muted, fontSize = 12.sp)
                            FitLine(vm, f.path)
                        }
                        LoadButton(vm, f, ready?.path)
                        TextButton(onClick = { confirmDelete = f }) { Text("Delete", color = Bad) }
                    }
                }
            }
        }
    }

    confirmDelete?.let { f ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete model?") },
            text = { Text("${vm.models.displayName(f.path)} will be removed from your phone (${f.length() / (1024 * 1024)} MB freed). You can download it again later.") },
            confirmButton = { TextButton(onClick = { vm.deleteModel(f); confirmDelete = null }) { Text("Delete", color = Bad) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ModelCard(vm: AppViewModel, m: CatalogModel, totalRamMb: Long, loadedPath: String?, onDelete: (File) -> Unit) {
    val file = vm.models.fileFor(m)
    val have = vm.localModels.any { it.name == m.file }
    val dl = vm.downloads[m.file]
    val estimate = remember(m.file) { SmartFit.estimateLevel(m.sizeMb.toLong(), vm.budgetMb()) }
    val tooBig = estimate == FitLevel.TOO_BIG
    Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(m.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Surface(color = if (m.tier == "Recommended") Accent else Panel2, shape = RoundedCornerShape(50)) {
                    Text(
                        m.tier, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        color = if (m.tier == "Recommended") Bg else Muted,
                    )
                }
            }
            Text(m.blurb, color = Muted, fontSize = 13.sp)
            Text(
                "${m.sizeMb} MB" + (if (m.canThink) " · can think" else "") + (if (tooBig) " · probably too big for this phone" else ""),
                color = if (tooBig) Warn else Muted, fontSize = 12.sp,
            )
            if (have) FitLine(vm, file.path)
            Spacer(Modifier.padding(4.dp))
            when {
                dl != null -> {
                    val frac = if (dl.totalBytes > 0) dl.doneBytes.toFloat() / dl.totalBytes else 0f
                    LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Downloading… %d / %d MB".format(dl.doneBytes / (1024 * 1024), maxOf(dl.totalBytes, 0) / (1024 * 1024)),
                            color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { vm.cancelDownload(m.file) }) { Text("Cancel") }
                    }
                }
                have -> Row(verticalAlignment = Alignment.CenterVertically) {
                    LoadButton(vm, file, loadedPath)
                    Spacer(Modifier.width(8.dp))
                    TextButton(onClick = { onDelete(file) }) { Text("Delete", color = Bad) }
                }
                else -> Button(onClick = { vm.startDownload(m) }) { Text("Download") }
            }
        }
    }
}

@Composable
private fun LoadButton(vm: AppViewModel, file: File, loadedPath: String?) {
    when {
        loadedPath == file.path -> Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CheckCircle, null, tint = Good)
            Spacer(Modifier.width(4.dp))
            Text("Loaded", color = Good)
        }
        vm.engine is EngineState.Loading -> Text("Loading…", color = Warn)
        else -> Button(onClick = { vm.loadModel(file.path) }, enabled = !vm.generating) { Text("Load") }
    }
}

/** Smart Fit result for a downloaded model: how it will run on this phone. */
@Composable
private fun FitLine(vm: AppViewModel, path: String) {
    if (!vm.settings.smartFit) return
    val plan = vm.fitPlans[path]
    when {
        !vm.fitPlans.containsKey(path) -> Text("Smart Fit: checking…", color = Muted, fontSize = 12.sp)
        plan == null -> Text("Smart Fit: couldn't read this file", color = Muted, fontSize = 12.sp)
        else -> Text(
            plan.describe(), fontSize = 12.sp,
            color = when (plan.level) { FitLevel.GOOD -> Good; FitLevel.TIGHT -> Warn; FitLevel.TOO_BIG -> Bad },
        )
    }
}
