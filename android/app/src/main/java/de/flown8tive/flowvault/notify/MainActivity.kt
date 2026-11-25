package de.flown8tive.flowvault.notify

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import de.flown8tive.flowvault.notify.model.PairingTarget
import de.flown8tive.flowvault.notify.model.PairingUriParser
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import de.flown8tive.flowvault.notify.ui.AppViewModel
import de.flown8tive.flowvault.notify.ui.ChannelsScreen
import de.flown8tive.flowvault.notify.ui.ChatScreen
import de.flown8tive.flowvault.notify.ui.PairingScreen
import de.flown8tive.flowvault.notify.ui.SettingsScreen
import de.flown8tive.flowvault.notify.ui.theme.FlowVaultTheme
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import java.net.URLDecoder
import java.net.URLEncoder

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()
    private val pendingPair = mutableStateOf<PairingTarget?>(null)
    private val pendingInstanceId = mutableStateOf<Int?>(null)

    private val notifPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        requestNotificationPermissionIfNeeded()

        setContent {
            FlowVaultTheme {
                val isPaired by vm.isPaired.collectAsState()
                val busy by vm.busy.collectAsState()
                val banner by vm.bannerMessage.collectAsState()
                val channels by vm.channels.collectAsState()
                val snackbar = remember { SnackbarHostState() }
                val nav = rememberNavController()

                LaunchedEffect(banner) {
                    banner?.let {
                        snackbar.showSnackbar(it)
                        vm.clearBanner()
                    }
                }

                // Direktsprung aus einer Android-Benachrichtigung in den Instanz-Chat
                val targetInst = pendingInstanceId.value
                LaunchedEffect(isPaired, targetInst, channels) {
                    if (isPaired && targetInst != null && targetInst > 0) {
                        val name = channels.firstOrNull { it.instanceId == targetInst }?.name ?: "Instanz #$targetInst"
                        pendingInstanceId.value = null
                        nav.navigate("chat/$targetInst/${URLEncoder.encode(name, "UTF-8")}") {
                            launchSingleTop = true
                        }
                    }
                }

                Scaffold(
                    containerColor = FvColors.Bg,
                    snackbarHost = { SnackbarHost(snackbar) },
                ) { innerPadding ->
                    Box(Modifier.fillMaxSize().padding(innerPadding)) {
                        if (!isPaired) {
                            PairingScreen(
                                initialTarget = pendingPair.value,
                                busy = busy,
                                error = banner,
                                onPair = { url, code, name ->
                                    pendingPair.value = null
                                    vm.pair(url, code, name)
                                },
                            )
                        } else {
                            NavHost(navController = nav, startDestination = "channels") {
                                composable("channels") {
                                    ChannelsScreen(
                                        vm = vm,
                                        onOpenChannel = { id, name ->
                                            nav.navigate("chat/$id/${URLEncoder.encode(name, "UTF-8")}")
                                        },
                                        onOpenAlerts = { nav.navigate("alerts") },
                                        onOpenSettings = { nav.navigate("settings") },
                                    )
                                }
                                composable(
                                    route = "chat/{instanceId}/{name}",
                                    arguments = listOf(
                                        navArgument("instanceId") { type = NavType.IntType },
                                        navArgument("name") { type = NavType.StringType },
                                    ),
                                ) { entry ->
                                    val id = entry.arguments?.getInt("instanceId") ?: 0
                                    val name = URLDecoder.decode(entry.arguments?.getString("name") ?: "Instanz", "UTF-8")
                                    ChatScreen(vm = vm, instanceId = id, title = name, onBack = { nav.popBackStack() })
                                }
                                composable("alerts") {
                                    ChatScreen(vm = vm, instanceId = null, title = "Offene Warnungen", onBack = { nav.popBackStack() })
                                }
                                composable("settings") {
                                    SettingsScreen(vm = vm, onBack = { nav.popBackStack() })
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.dataString
        if (!data.isNullOrBlank()) {
            PairingUriParser.parse(data)?.let { pendingPair.value = it }
        }
        val instId = intent?.getIntExtra(NotificationHelper.EXTRA_OPEN_INSTANCE_ID, -1) ?: -1
        if (instId > 0) pendingInstanceId.value = instId
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!granted) notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
