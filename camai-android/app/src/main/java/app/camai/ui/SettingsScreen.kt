package app.camai.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.BuildConfigInfo
import app.camai.DEFAULT_SYSTEM_PROMPT
import app.camai.EngineState
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val s = vm.settings
    val context = LocalContext.current
    val cores = remember { Runtime.getRuntime().availableProcessors() }
    var showKey by remember { mutableStateOf(false) }
    var pickCloud by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                title = { Text("Settings") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { Section("You") }
            item {
                OutlinedTextField(s.userName, { v -> vm.updateSettings { it.copy(userName = v) } },
                    label = { Text("Your name (characters will use it)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }

            item { Section("CamAI's personality") }
            item {
                OutlinedTextField(s.systemPrompt, { v -> vm.updateSettings { it.copy(systemPrompt = v) } },
                    label = { Text("Instructions for the default assistant") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { vm.updateSettings { it.copy(systemPrompt = DEFAULT_SYSTEM_PROMPT) } }) { Text("Reset to default") }
            }

            item { Section("Replies") }
            item {
                Label("Creativity: %.1f".format(s.temperature), "Low = focused and factual. High = more varied and creative.")
                Slider(s.temperature, { v -> vm.updateSettings { it.copy(temperature = (v * 10).roundToInt() / 10f) } }, valueRange = 0f..1.5f)
            }
            item {
                Label("Max reply length: ${s.maxTokens} tokens (~${s.maxTokens * 3 / 4} words)", "Longer replies take longer on a phone.")
                Slider(s.maxTokens.toFloat(), { v -> vm.updateSettings { it.copy(maxTokens = (v / 64).roundToInt() * 64) } }, valueRange = 128f..2048f)
            }
            item {
                Toggle("Let models think first", "For models marked \"can think\". Smarter answers, but much slower.", s.thinking) { v ->
                    vm.updateSettings { it.copy(thinking = v) }
                }
            }
            item {
                Toggle("Read replies aloud", "Speaks each new reply using your phone's voice.", s.autoSpeak) { v ->
                    vm.updateSettings { it.copy(autoSpeak = v) }
                }
            }

            item { Section("Speed & memory") }
            item {
                Label("Conversation memory: ${s.contextSize} tokens", "More memory remembers longer chats but uses more RAM. Applies the next time a model loads.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(2048, 4096, 8192).forEach { n ->
                        FilterChip(selected = s.contextSize == n, onClick = { vm.updateSettings { it.copy(contextSize = n) } }, label = { Text("$n") })
                    }
                }
            }
            item {
                Label(
                    "CPU threads: " + if (s.threads == 0) "Automatic (${vm.autoThreads()})" else "${s.threads}",
                    "Your phone has $cores cores. More isn't always faster: the speed test finds the best number.",
                )
                Slider(s.threads.toFloat(), { v -> vm.updateSettings { it.copy(threads = v.roundToInt()) } },
                    valueRange = 0f..cores.toFloat(), steps = (cores - 1).coerceAtLeast(0))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { vm.runSpeedTest() }, enabled = vm.engine is EngineState.Ready && !vm.benchRunning && !vm.generating) {
                        Text("Find fastest setting")
                    }
                    if (vm.benchRunning) CircularProgressIndicator(Modifier.padding(start = 12.dp).heightIn(max = 24.dp))
                }
                if (vm.engine !is EngineState.Ready) Text("Load a model first to run the speed test.", color = Muted, fontSize = 12.sp)
                vm.benchResult?.let { Text(it, color = Good, fontSize = 13.sp) }
            }
            item {
                Toggle("Load last model on start", "Gets you chatting faster when you open the app.", s.autoLoad) { v ->
                    vm.updateSettings { it.copy(autoLoad = v) }
                }
            }

            item { Section("Cloud boost (optional)") }
            item {
                Text(
                    "Use big, fast cloud models when you want smarter answers. Free with an OpenRouter account: no payment needed for free models. " +
                        "Cloud chats leave your phone; on-device chats never do. Switch per chat with the phone/cloud icon.",
                    color = Muted, fontSize = 13.sp,
                )
                OutlinedTextField(
                    s.openRouterKey, { v -> vm.updateSettings { it.copy(openRouterKey = v.trim()) } },
                    label = { Text("OpenRouter API key") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showKey = !showKey }) {
                            Icon(if (showKey) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, "Show key")
                        }
                    },
                )
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://openrouter.ai/keys"))) }) {
                    Text("Get a free key at openrouter.ai/keys")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Cloud model: ${s.cloudModel}", modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { pickCloud = true; vm.loadCloudModels() }) { Text("Change") }
                }
            }

            item { Section("About") }
            item {
                Text(
                    "CamAI ${BuildConfigInfo.version} · on-device AI powered by llama.cpp. Your chats are stored only on this phone.",
                    color = Muted, fontSize = 13.sp,
                )
            }
        }
    }

    if (pickCloud) {
        AlertDialog(
            onDismissRequest = { pickCloud = false },
            title = { Text("Free cloud models") },
            text = {
                if (vm.cloudModels.isEmpty()) {
                    Text("Loading the list…", color = Muted)
                } else {
                    LazyColumn(Modifier.heightIn(max = 420.dp)) {
                        items(vm.cloudModels) { id ->
                            Text(
                                (if (id == s.cloudModel) "✓ " else "") + id + if (id == "openrouter/free") "  (auto-picks a free model)" else "",
                                color = if (id == s.cloudModel) Accent else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.fillMaxWidth().clickable {
                                    vm.updateSettings { it.copy(cloudModel = id) }
                                    pickCloud = false
                                }.padding(vertical = 10.dp),
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pickCloud = false }) { Text("Close") } },
        )
    }
}

@Composable
fun Section(title: String) {
    Column {
        HorizontalDivider(color = Line)
        Text(title, color = Accent, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun Label(title: String, help: String) {
    Text(title)
    Text(help, color = Muted, fontSize = 12.sp)
}

@Composable
private fun Toggle(title: String, help: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) }) {
        Column(Modifier.weight(1f)) { Label(title, help) }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
