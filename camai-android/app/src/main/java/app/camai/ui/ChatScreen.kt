package app.camai.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileRenameOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SuggestionChip
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.Character
import app.camai.ChatMessage
import app.camai.DEFAULT_CHARACTER_ID
import app.camai.EngineState
import app.camai.Prompting
import app.camai.Screen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(vm: AppViewModel, openDrawer: () -> Unit) {
    val context = LocalContext.current
    val chat = vm.currentChat
    val character = vm.characterFor(chat)
    var input by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<ChatMessage?>(null) }
    var renaming by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val heard = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) input = (input.trimEnd() + " " + heard).trim()
    }
    fun startVoice() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to ${character.name}")
        try {
            voice.launch(intent)
        } catch (e: ActivityNotFoundException) {
            vm.notice = "No speech recognizer on this phone. Installing the Google app adds one."
        }
    }

    val streaming = vm.generating && vm.streamingChatId == chat?.id
    val messages = chat?.messages.orEmpty()
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size, streaming) { if (messages.isNotEmpty() || streaming) listState.animateScrollToItem(0) }

    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                navigationIcon = { IconButton(onClick = openDrawer) { Icon(Icons.Filled.Menu, "Menu") } },
                title = {
                    Column {
                        Text(
                            "${character.emoji}  " + (chat?.title ?: character.name),
                            maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium,
                        )
                        EngineSubtitle(vm, chat?.useCloud == true)
                    }
                },
                actions = {
                    IconButton(onClick = { vm.toggleCloud() }) {
                        if (chat?.useCloud == true) Icon(Icons.Filled.Cloud, "Using cloud. Tap to use phone", tint = Accent)
                        else Icon(Icons.Filled.PhoneAndroid, "Using phone. Tap to use cloud")
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("New chat") }, leadingIcon = { Icon(Icons.Filled.Add, null) },
                                onClick = { menu = false; vm.newChat(chat?.characterId ?: DEFAULT_CHARACTER_ID) })
                            if (chat != null) {
                                DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(Icons.Filled.DriveFileRenameOutline, null) },
                                    onClick = { menu = false; renaming = true })
                                DropdownMenuItem(text = { Text("Share chat") }, leadingIcon = { Icon(Icons.Filled.Share, null) }, onClick = {
                                    menu = false
                                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, vm.transcript(chat))
                                    context.startActivity(Intent.createChooser(send, "Share chat"))
                                })
                                DropdownMenuItem(text = { Text("Delete chat") }, leadingIcon = { Icon(Icons.Filled.Delete, null) },
                                    onClick = { menu = false; confirmDelete = true })
                            }
                        }
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad).imePadding()) {
            if (messages.isEmpty() && !streaming) {
                EmptyChat(vm, character, chat?.useCloud == true, Modifier.weight(1f)) { input = it }
            } else {
                LazyColumn(
                    state = listState, reverseLayout = true, modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (streaming) {
                        item(key = "streaming") {
                            AssistantBubble(vm, ChatMessage(id = "streaming", role = "assistant", content = vm.streamText), character, isLast = false, live = true)
                        }
                    }
                    val reversed = messages.asReversed()
                    items(reversed, key = { it.id }) { m ->
                        if (m.role == "user") UserBubble(m, onEdit = { editing = m }, enabled = !vm.generating)
                        else AssistantBubble(vm, m, character, isLast = m.id == messages.last().id && !vm.generating, live = false)
                    }
                }
            }
            Composer(
                value = input, onValue = { input = it }, generating = streaming || (vm.generating && chat?.id == vm.streamingChatId),
                placeholder = "Message ${character.name}…",
                onSend = { if (vm.send(input)) input = "" },
                onStop = { vm.stop() },
                onMic = { startVoice() },
            )
        }
    }

    editing?.let { m ->
        var text by remember(m.id) { mutableStateOf(m.content) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Edit message") },
            text = { OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth(), minLines = 3) },
            confirmButton = { TextButton(onClick = { vm.editAndResend(m.id, text); editing = null }) { Text("Send again") } },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
        )
    }
    if (renaming && chat != null) {
        var title by remember { mutableStateOf(chat.title) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("Rename chat") },
            text = { OutlinedTextField(title, { title = it }, singleLine = true) },
            confirmButton = { TextButton(onClick = { vm.renameChat(chat.id, title); renaming = false }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("Cancel") } },
        )
    }
    if (confirmDelete && chat != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this chat?") },
            text = { Text("\"${chat.title}\" will be permanently deleted.") },
            confirmButton = { TextButton(onClick = { vm.deleteChat(chat.id); confirmDelete = false }) { Text("Delete", color = Bad) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun EngineSubtitle(vm: AppViewModel, cloud: Boolean) {
    val (text, color) = if (cloud) {
        "Cloud · ${vm.settings.cloudModel}" to Accent
    } else when (val e = vm.engine) {
        is EngineState.Off -> "No model loaded" to Warn
        is EngineState.Loading -> "Loading ${e.name}…" to Warn
        is EngineState.Ready -> "${e.name} · on your phone" to Good
        is EngineState.Failed -> "Model failed to load" to Bad
    }
    Text(text, color = color, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun EmptyChat(vm: AppViewModel, character: Character, cloud: Boolean, modifier: Modifier, onPick: (String) -> Unit) {
    Column(
        modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(character.emoji, fontSize = 48.sp)
        Spacer(Modifier.height(8.dp))
        Text(character.name, style = MaterialTheme.typography.headlineSmall)
        if (character.tagline.isNotBlank()) Text(character.tagline, color = Muted)
        Spacer(Modifier.height(20.dp))
        val needsModel = !cloud && vm.engine !is EngineState.Ready && vm.engine !is EngineState.Loading
        if (needsModel) {
            Card(colors = CardDefaults.cardColors(containerColor = Panel2)) {
                Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("To chat offline, download an AI model to your phone first (one time).", color = Muted)
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = { vm.screen = Screen.MODELS }) { Text("Choose a model") }
                }
            }
        } else if (character.id == DEFAULT_CHARACTER_ID) {
            listOf("Explain how WiFi works simply", "Write a short poem about rain", "Help me plan my week").forEach {
                SuggestionChip(onClick = { onPick(it) }, label = { Text(it) })
            }
        }
    }
}

@Composable
private fun UserBubble(m: ChatMessage, onEdit: () -> Unit, enabled: Boolean) {
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Surface(color = UserBubble, shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp), modifier = Modifier.widthIn(max = 320.dp)) {
            Text(m.content, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp), style = MaterialTheme.typography.bodyLarge)
        }
        Row {
            SmallAction(Icons.Filled.ContentCopy, "Copy") { copyToClipboard(context, m.content) }
            if (enabled) SmallAction(Icons.Filled.Edit, "Edit and resend", onEdit)
        }
    }
}

@Composable
private fun AssistantBubble(vm: AppViewModel, m: ChatMessage, character: Character, isLast: Boolean, live: Boolean) {
    val context = LocalContext.current
    val (thoughts, answer) = Prompting.splitThoughts(m.content)
    val thinking = live && Prompting.isStillThinking(m.content)
    Row(Modifier.fillMaxWidth()) {
        Box(Modifier.size(30.dp).background(Panel2, CircleShape), contentAlignment = Alignment.Center) {
            Text(character.emoji, fontSize = 15.sp)
        }
        Spacer(Modifier.size(8.dp))
        Column(Modifier.weight(1f)) {
            if (thoughts != null) ThoughtsBox(thoughts, thinking)
            when {
                answer.isNotEmpty() -> MarkdownText(answer, if (m.error) Bad else MaterialTheme.colorScheme.onSurface)
                live && !thinking -> Text("…", color = Muted, fontSize = 20.sp)
            }
            if (!live) {
                m.stats?.let { Text(it, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)) }
                Row {
                    SmallAction(Icons.Filled.ContentCopy, "Copy") { copyToClipboard(context, answer) }
                    SmallAction(
                        if (vm.speakingId == m.id) Icons.Filled.StopCircle else Icons.AutoMirrored.Filled.VolumeUp,
                        if (vm.speakingId == m.id) "Stop reading" else "Read aloud",
                    ) { vm.speak(m) }
                    if (isLast) SmallAction(Icons.Filled.Refresh, "Regenerate") { vm.regenerate() }
                }
            }
        }
    }
}

@Composable
private fun ThoughtsBox(thoughts: String, thinking: Boolean) {
    var open by remember { mutableStateOf(false) }
    Surface(color = Panel, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp).animateContentSize()) {
        Column(Modifier.clickable { open = !open }.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (thinking) "💭 Thinking…" else "💭 Thoughts", color = Muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Muted)
            }
            if (open || thinking) {
                Text(
                    if (open) thoughts else thoughts.takeLast(240), color = Muted, fontSize = 13.sp, fontStyle = FontStyle.Italic,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun SmallAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(34.dp)) {
        Icon(icon, contentDescription = label, tint = Muted, modifier = Modifier.size(17.dp))
    }
}

@Composable
private fun Composer(
    value: String, onValue: (String) -> Unit, generating: Boolean, placeholder: String,
    onSend: () -> Unit, onStop: () -> Unit, onMic: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().background(Bg).padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        OutlinedTextField(
            value = value, onValueChange = onValue, modifier = Modifier.weight(1f),
            placeholder = { Text(placeholder, color = Muted) }, maxLines = 6, shape = RoundedCornerShape(22.dp),
        )
        Spacer(Modifier.size(4.dp))
        IconButton(onClick = onMic, modifier = Modifier.padding(bottom = 4.dp)) { Icon(Icons.Filled.Mic, "Speak") }
        if (generating) {
            FilledIconButton(onClick = onStop, modifier = Modifier.padding(bottom = 4.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Bad)) { Icon(Icons.Filled.Stop, "Stop") }
        } else {
            FilledIconButton(onClick = onSend, enabled = value.isNotBlank(), modifier = Modifier.padding(bottom = 4.dp)) {
                Icon(Icons.AutoMirrored.Filled.Send, "Send")
            }
        }
    }
}
