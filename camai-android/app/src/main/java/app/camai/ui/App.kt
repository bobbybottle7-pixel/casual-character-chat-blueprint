package app.camai.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.camai.AppViewModel
import app.camai.EngineState
import app.camai.Screen
import kotlinx.coroutines.launch

@Composable
fun App(vm: AppViewModel) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    val view = LocalView.current
    var showCrash by remember { mutableStateOf(vm.crashReport != null) }

    // Keep the screen awake while the model loads or writes, so Android doesn't pause it.
    val busy = vm.generating || vm.engine is EngineState.Loading || vm.benchRunning
    LaunchedEffect(busy) { view.keepScreenOn = busy }

    LaunchedEffect(vm.notice) {
        vm.notice?.let {
            vm.notice = null
            snackbar.showSnackbar(it)
        }
    }

    val back = {
        when {
            vm.screen == Screen.FINDER && vm.finderRepo != null -> vm.closeRepo()
            vm.screen == Screen.FINDER -> vm.screen = Screen.MODELS
            vm.screen == Screen.EDIT_CHARACTER -> vm.screen = Screen.CHARACTERS
            else -> vm.screen = Screen.CHAT
        }
    }
    BackHandler(enabled = vm.screen != Screen.CHAT) { back() }
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }

    fun go(s: Screen) {
        vm.screen = s
        scope.launch { drawer.close() }
    }

    Box(Modifier.fillMaxSize()) {
        ModalNavigationDrawer(
            drawerState = drawer,
            gesturesEnabled = vm.screen == Screen.CHAT,
            drawerContent = {
                ModalDrawerSheet(drawerContainerColor = Panel) {
                    Text("◈ CamAI", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(20.dp))
                    val itemColors = NavigationDrawerItemDefaults.colors(unselectedContainerColor = Panel)
                    NavigationDrawerItem(label = { Text("New chat") }, icon = { Icon(Icons.Filled.Add, null) }, selected = false,
                        colors = itemColors, onClick = { vm.newChat(); scope.launch { drawer.close() } },
                        modifier = Modifier.padding(horizontal = 12.dp))
                    NavigationDrawerItem(label = { Text("Characters") }, icon = { Icon(Icons.Filled.Face, null) }, selected = false,
                        colors = itemColors, onClick = { go(Screen.CHARACTERS) }, modifier = Modifier.padding(horizontal = 12.dp))
                    NavigationDrawerItem(label = { Text("Models") }, icon = { Icon(Icons.Filled.Memory, null) }, selected = false,
                        colors = itemColors, onClick = { go(Screen.MODELS) }, modifier = Modifier.padding(horizontal = 12.dp))
                    NavigationDrawerItem(label = { Text("Settings") }, icon = { Icon(Icons.Filled.Settings, null) }, selected = false,
                        colors = itemColors, onClick = { go(Screen.SETTINGS) }, modifier = Modifier.padding(horizontal = 12.dp))
                    NavigationDrawerItem(label = { Text("Diagnostics") }, icon = { Icon(Icons.Filled.BugReport, null) }, selected = false,
                        colors = itemColors, onClick = { go(Screen.DIAGNOSTICS) }, modifier = Modifier.padding(horizontal = 12.dp))
                    HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 8.dp))
                    Text("Chats", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 28.dp, vertical = 4.dp))
                    LazyColumn {
                        items(vm.chats, key = { it.id }) { c ->
                            NavigationDrawerItem(
                                label = { Text("${vm.characterFor(c).emoji}  ${c.title}", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                selected = c.id == vm.currentChatId,
                                onClick = { vm.openChat(c.id); scope.launch { drawer.close() } },
                                colors = itemColors,
                                modifier = Modifier.padding(horizontal = 12.dp),
                            )
                        }
                        item { Spacer(Modifier.height(24.dp)) }
                    }
                }
            },
        ) {
            when (vm.screen) {
                Screen.CHAT -> ChatScreen(vm) { scope.launch { drawer.open() } }
                Screen.MODELS -> ModelsScreen(vm, back)
                Screen.FINDER -> FinderScreen(vm, back)
                Screen.SETTINGS -> SettingsScreen(vm, back)
                Screen.CHARACTERS -> CharactersScreen(vm, back)
                Screen.EDIT_CHARACTER -> CharacterEditor(vm, back)
                Screen.DIAGNOSTICS -> DiagnosticsScreen(vm, back)
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 56.dp))
    }

    if (showCrash) {
        val report = vm.crashReport.orEmpty()
        AlertDialog(
            onDismissRequest = { showCrash = false },
            title = { Text("CamAI closed unexpectedly last time") },
            text = {
                Text(report, fontSize = 13.sp, modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()))
            },
            confirmButton = { TextButton(onClick = { showCrash = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { copyToClipboard(context, diagnosticsText(vm)) }) { Text("Copy details") } },
        )
    }
}
