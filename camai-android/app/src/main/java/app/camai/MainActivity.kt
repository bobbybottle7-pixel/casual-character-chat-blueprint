package app.camai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import app.camai.ui.App
import app.camai.ui.CamAITheme

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        CrashGuard.install(applicationContext)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { CamAITheme { App(vm) } }
    }

    override fun onStop() {
        super.onStop()
        vm.onBackground()  // Instant Resume: save the current chat's model state
    }
}
