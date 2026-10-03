package app.camai.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.Character
import app.camai.newId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CharactersScreen(vm: AppViewModel, onBack: () -> Unit) {
    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                title = { Text("Characters") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { vm.editCharacter(null) }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Create") })
        },
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item { Text("Tap a character to start a new chat.", color = Muted, fontSize = 13.sp) }
            items(vm.characters, key = { it.id }) { c ->
                Surface(color = Panel, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().clickable { vm.newChat(c.id) }) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(44.dp).background(Panel2, CircleShape), contentAlignment = Alignment.Center) {
                            Text(c.emoji, fontSize = 22.sp)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.name, style = MaterialTheme.typography.titleMedium)
                            if (c.tagline.isNotBlank()) Text(c.tagline, color = Muted, fontSize = 13.sp, maxLines = 2)
                        }
                        if (c.builtIn) {
                            IconButton(onClick = { vm.editCharacter(c.copy(id = newId(), name = c.name + " (copy)", builtIn = false)) }) {
                                Icon(Icons.Filled.ContentCopy, "Copy and customise", tint = Muted)
                            }
                        } else {
                            IconButton(onClick = { vm.editCharacter(c) }) { Icon(Icons.Filled.Edit, "Edit", tint = Muted) }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CharacterEditor(vm: AppViewModel, onBack: () -> Unit) {
    val original = vm.editingCharacter ?: return
    val isExisting = vm.customCharacters.any { it.id == original.id }
    var c by remember(original.id) { mutableStateOf(original) }
    var confirmDelete by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                title = { Text(if (isExisting) "Edit character" else "New character") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(c.emoji, { c = c.copy(emoji = it.take(4)) }, label = { Text("Emoji") }, singleLine = true, modifier = Modifier.width(90.dp))
                OutlinedTextField(c.name, { c = c.copy(name = it) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.weight(1f))
            }
            Field("Short description", "e.g. A grumpy wizard who secretly loves tea", c.tagline) { c = c.copy(tagline = it) }
            Field("Personality", "How they talk and behave, what they like, their quirks…", c.personality, 4) { c = c.copy(personality = it) }
            Field("Scenario (optional)", "Where and how the conversation takes place", c.scenario, 3) { c = c.copy(scenario = it) }
            Field("First message (optional)", "What they say to open a new chat. {{user}} becomes your name.", c.greeting, 3) { c = c.copy(greeting = it) }
            Text(
                "Tip: small on-phone models follow short, clear descriptions best. Cloud models handle long, detailed ones.",
                color = Muted, fontSize = 12.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { vm.saveCharacter(c) }, enabled = c.name.isNotBlank()) { Text("Save") }
                if (isExisting) TextButton(onClick = { confirmDelete = true }) { Text("Delete", color = Bad) }
            }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete ${c.name}?") },
            text = { Text("Existing chats with this character are kept, but will use the default assistant.") },
            confirmButton = { TextButton(onClick = { vm.deleteCharacter(c.id); confirmDelete = false }) { Text("Delete", color = Bad) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Field(label: String, hint: String, value: String, minLines: Int = 1, onChange: (String) -> Unit) {
    OutlinedTextField(
        value, onChange, label = { Text(label) }, placeholder = { Text(hint, color = Muted) },
        minLines = minLines, singleLine = minLines == 1, modifier = Modifier.fillMaxWidth(),
    )
}
