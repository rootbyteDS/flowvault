package de.flown8tive.flowvault.notify

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import de.flown8tive.flowvault.notify.model.PairingTarget
import de.flown8tive.flowvault.notify.model.PairingUriParser
import de.flown8tive.flowvault.notify.notify.NotificationHelper
import de.flown8tive.flowvault.notify.ui.AppViewModel
import de.flown8tive.flowvault.notify.ui.BiometricAuthHelper
import de.flown8tive.flowvault.notify.ui.ChannelsScreen
import de.flown8tive.flowvault.notify.ui.ChatScreen
import de.flown8tive.flowvault.notify.ui.FocusScreen
import de.flown8tive.flowvault.notify.ui.PairingScreen
import de.flown8tive.flowvault.notify.ui.PermissionHelper
import de.flown8tive.flowvault.notify.ui.RollbackBottomSheet
import de.flown8tive.flowvault.notify.ui.SearchScreen
import de.flown8tive.flowvault.notify.ui.SettingsScreen
import de.flown8tive.flowvault.notify.ui.theme.FlowVaultTheme
import de.flown8tive.flowvault.notify.ui.theme.FvColors
import java.net.URLDecoder
import java.net.URLEncoder

private data class HubTab(
    val route: String,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

private val HUB_TABS = listOf(
    HubTab("channels", "Instanzen", Icons.Default.Dns),
    HubTab("focus", "Fokus", Icons.Default.Inbox),
    HubTab("search", "Suche", Icons.Default.Search),
    HubTab("settings", "Schutz", Icons.Default.Shield),
)

class MainActivity : FragmentActivity() {
    private val vm: AppViewModel by viewModels()
    private val pendingPair = mutableStateOf<PairingTarget?>(null)
    private val pendingInstanceId = mutableStateOf<Int?>(null)
    private val pendingTab = mutableStateOf<String?>(null)

    private val notifPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        requestNotificationPermissionIfNeeded()

        setContent {
            FlowVaultTheme {
                val lifecycleOwner = LocalLifecycleOwner.current
                val isPaired by vm.isPaired.collectAsState()
                val busy by vm.busy.collectAsState()
                val banner by vm.bannerMessage.collectAsState()
                val channels by vm.channels.collectAsState()
                val openAlerts by vm.openAlerts.collectAsState()
                val unreadMessages by vm.unreadMessages.collectAsState()
                val pendingRollback by vm.pendingRollback.collectAsState()
                val rollbackBusy by vm.rollbackBusy.collectAsState()

                var permStatus by remember { mutableStateOf(PermissionHelper.check(this@MainActivity)) }
                DisposableEffect(lifecycleOwner) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            permStatus = PermissionHelper.check(this@MainActivity)
                        }
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
                }

                val snackbar = remember { SnackbarHostState() }
                val nav = rememberNavController()
                val backStackEntry by nav.currentBackStackEntryAsState()
                val currentRoute = backStackEntry?.destination?.route
                val showBottomHub = isPaired && HUB_TABS.any { it.route == currentRoute }

                val totalUnread = remember(channels) { channels.sumOf { it.unreadCount } }
                val focusBadgeCount = remember(openAlerts, unreadMessages, totalUnread) {
                    val distinctSeqs = (openAlerts.map { it.seq } + unreadMessages.map { it.seq }).toSet().size
                    maxOf(distinctSeqs, totalUnread)
                }

                LaunchedEffect(banner) {
                    banner?.let {
                        snackbar.showSnackbar(it)
                        vm.clearBanner()
                    }
                }

                // Direktsprung aus Benachrichtigung oder Startbildschirm-Widget
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

                val targetTab = pendingTab.value
                LaunchedEffect(isPaired, targetTab) {
                    if (isPaired && !targetTab.isNullOrBlank() && HUB_TABS.any { it.route == targetTab }) {
                        pendingTab.value = null
                        nav.navigate(targetTab) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                }

                Scaffold(
                    containerColor = FvColors.Bg,
                    snackbarHost = { SnackbarHost(snackbar) },
                    bottomBar = {
                        if (showBottomHub) {
                            Column(Modifier.fillMaxWidth().background(FvColors.Sidebar)) {
                                HorizontalDivider(color = FvColors.Line2)
                                NavigationBar(containerColor = FvColors.Sidebar) {
                                    HUB_TABS.forEach { tab ->
                                        val selected = currentRoute == tab.route
                                        NavigationBarItem(
                                            selected = selected,
                                            onClick = {
                                                if (!selected) {
                                                    nav.navigate(tab.route) {
                                                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                                        launchSingleTop = true
                                                        restoreState = true
                                                    }
                                                }
                                            },
                                            icon = {
                                                BadgedBox(
                                                    badge = {
                                                        when (tab.route) {
                                                            "channels" -> if (openAlerts.isNotEmpty()) {
                                                                Badge(containerColor = FvColors.Del, contentColor = FvColors.Text) {
                                                                    Text("${openAlerts.size}")
                                                                }
                                                            }
                                                            "focus" -> if (focusBadgeCount > 0) {
                                                                Badge(
                                                                    containerColor = if (openAlerts.isNotEmpty()) FvColors.Del else FvColors.Accent,
                                                                    contentColor = FvColors.Text,
                                                                ) {
                                                                    Text(if (focusBadgeCount > 99) "99+" else "$focusBadgeCount")
                                                                }
                                                            }
                                                            "settings" -> if (!permStatus.allOptimal) {
                                                                Badge(containerColor = FvColors.Mod, contentColor = FvColors.Sidebar) {
                                                                    Text("!")
                                                                }
                                                            }
                                                        }
                                                    },
                                                ) {
                                                    Icon(tab.icon, contentDescription = tab.label)
                                                }
                                            },
                                            label = {
                                                Text(
                                                    tab.label,
                                                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                                )
                                            },
                                            colors = NavigationBarItemDefaults.colors(
                                                selectedIconColor = FvColors.AccentHi,
                                                selectedTextColor = FvColors.Text,
                                                indicatorColor = FvColors.Accent.copy(alpha = 0.22f),
                                                unselectedIconColor = FvColors.Muted,
                                                unselectedTextColor = FvColors.Muted,
                                            ),
                                        )
                                    }
                                }
                            }
                        }
                    },
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
                                        onOpenFocus = {
                                            nav.navigate("focus") {
                                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                                launchSingleTop = true
                                                restoreState = true
                                            }
                                        },
                                    )
                                }
                                composable("focus") {
                                    FocusScreen(
                                        vm = vm,
                                        onOpenChannel = { id, name ->
                                            nav.navigate("chat/$id/${URLEncoder.encode(name, "UTF-8")}")
                                        },
                                    )
                                }
                                composable("search") {
                                    SearchScreen(
                                        vm = vm,
                                        onOpenChannel = { id, name ->
                                            nav.navigate("chat/$id/${URLEncoder.encode(name, "UTF-8")}")
                                        },
                                    )
                                }
                                composable("settings") {
                                    SettingsScreen(vm = vm)
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
                            }
                        }
                    }
                }

                // Daumenfreundliches Biometrie-Bottom-Sheet für signiertes Rollback (überall verfügbar)
                pendingRollback?.let { ch ->
                    RollbackBottomSheet(
                        challenge = ch,
                        busy = rollbackBusy,
                        onDismiss = { if (!rollbackBusy) vm.cancelRollback() },
                        onConfirm = {
                            BiometricAuthHelper.authenticateForRollback(
                                activity = this@MainActivity,
                                title = "Auf v${ch.targetVersionNumber} zurückspielen",
                                subtitle = "${ch.instanceName} · ${ch.workflowName}",
                                description = "Bestätige das signierte Zurückspielen von v${ch.currentVersionNumber} auf v${ch.targetVersionNumber}.",
                                onAuthorized = { vm.executeConfirmedRollback(ch) },
                                onError = { err -> vm.showBanner(err) },
                            )
                        },
                    )
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
        val tab = intent?.getStringExtra(NotificationHelper.EXTRA_OPEN_TAB)
        if (!tab.isNullOrBlank()) pendingTab.value = tab
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!granted) notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
