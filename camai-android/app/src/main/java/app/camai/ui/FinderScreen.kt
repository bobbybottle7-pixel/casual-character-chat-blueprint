package app.camai.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.FitLevel
import app.camai.HfFile
import app.camai.SmartFit

private val QUICK = listOf("Qwen3.5", "LFM2.5", "gemma-4", "Llama-3.2", "SmolLM3", "Phi-4-mini", "roleplay")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FinderScreen(vm: AppViewModel, onBack: () -> Unit) {
    val repo = vm.finderRepo
    val budget = remember(repo) { vm.budgetMb() }
    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                title = { Text(repo ?: "Find models", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            if (repo == null) {
                OutlinedTextField(
                    value = vm.finderQuery, onValueChange = { vm.finderQuery = it },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    placeholder = { Text("Search Hugging Face, e.g. qwen 2b") }, singleLine = true,
                    leadingIcon = { Icon(Icons.Filled.Search, null) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { vm.searchModels() }),
                )
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    QUICK.forEach { q -> SuggestionChip(onClick = { vm.searchModels(q) }, label = { Text(q) }) }
                }
            }
            if (vm.finderBusy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 12.dp))
            vm.finderError?.let { Text(it, color = Warn, fontSize = 13.sp, modifier = Modifier.padding(12.dp)) }

            LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (repo == null) {
                    if (vm.finderResults.isEmpty() && !vm.finderBusy && vm.finderError == null) {
                        item {
                            Text(
                                "Search thousands of free AI models. Smaller files run faster; look for ones marked \"Fits well\". " +
                                    "Pick chat or \"instruct\" models: base models don't follow conversations.",
                                color = Muted, fontSize = 13.sp,
                            )
                        }
                    }
                    items(vm.finderResults, key = { it.id }) { r ->
                        Surface(color = Panel, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().clickable { vm.openRepo(r.id) }) {
                            Column(Modifier.padding(12.dp)) {
                                Text(r.id.substringAfter('/'), style = MaterialTheme.typography.titleSmall)
                                Text("by ${r.id.substringBefore('/')} · ${compact(r.downloads)} downloads · ${r.likes} likes", color = Muted, fontSize = 12.sp)
                            }
                        }
                    }
                } else {
                    if (vm.finderFiles.isNotEmpty()) {
                        item {
                            Text(
                                "Recommended: Q4_0 (fastest on phones) or Q4_K_M (a bit more accurate). Ratings use your phone's free memory (~$budget MB).",
                                color = Muted, fontSize = 13.sp,
                            )
                        }
                    }
                    items(vm.finderFiles, key = { it.name }) { f -> FileRow(vm, f, budget) }
                }
            }
        }
    }
}

@Composable
private fun FileRow(vm: AppViewModel, f: HfFile, budget: Long) {
    val level = SmartFit.estimateLevel(f.sizeMb, budget)
    val have = vm.localModels.any { it.name == f.fileName }
    val downloading = vm.downloads.containsKey(f.fileName)
    Surface(color = Panel, shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(f.fileName, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${f.sizeMb} MB" + if (f.quant.isNotEmpty()) " · ${f.quant}" else "", color = Muted, fontSize = 12.sp)
                    FitBadge(level)
                }
            }
            when {
                have -> Text("Downloaded", color = Good, fontSize = 13.sp)
                downloading -> Text("Downloading…", color = Warn, fontSize = 13.sp)
                else -> Button(onClick = { vm.downloadHf(f) }) { Text("Get") }
            }
        }
    }
}

@Composable
fun FitBadge(level: FitLevel) {
    val (label, color) = when (level) {
        FitLevel.GOOD -> "Fits well" to Good
        FitLevel.TIGHT -> "Tight" to Warn
        FitLevel.TOO_BIG -> "Too big" to Bad
    }
    Text(label, color = color, fontSize = 12.sp)
}

private fun compact(n: Long): String = when {
    n >= 1_000_000 -> "%.1fM".format(n / 1e6)
    n >= 1_000 -> "%.1fk".format(n / 1e3)
    else -> n.toString()
}
