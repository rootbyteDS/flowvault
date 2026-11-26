# FlowVault Notify (Android)

Android-Companion-App für FlowVault mit Messenger-Ansicht für n8n-Fehlläufe, Health-Regressionen, Sync-Störungen und Workflow-Änderungen.

## Features

- **QR-Code-Kopplung** direkt aus FlowVault (**Einstellungen → Mobile App & Benachrichtigungen**) via CameraX + ZXing (ohne Google Play Services)
- **Ende-zu-Ende-verschlüsselte Ursachenanalyse (`ECDH-P256-HKDF-AES256GCM`):** Korreliert fehlgeschlagene Nodes mit dem Workflow-Diff (und optional Melious-KI) direkt im Messenger – `notify.db` sieht nur Chiffretext
- **Biometrisch signiertes Zurückspielen (Rollback):** Hardware-ECDSA-Schlüssel im `AndroidKeyStore` + `BiometricPrompt` über eine 60s-Einmal-Challenge (pro Gerät in FlowVault Web freischaltbar)
- **Messenger-Kanäle pro n8n-Instanz** mit Instanz-Farbe, Health-Status-Punkt, Vorschau, Ungelesen-Zähler, Suche, Filter-Chips und Stummschaltung
- **Gepinnte Ansicht „Offene kritische Warnungen“** über alle Instanzen
- **Offline-First** über Room-Datenbank + lückenloser Cursor-Sync (`after=<seq>`)
- **Drei Zustellmodi:**
  1. **UnifiedPush** (z. B. selbst gehostetes `ntfy` / `Sunup`) mit Zero-Payload-Wakeup (kein Klartext über Dritte)
  2. **Echtzeit-Hintergrunddienst (SSE)** direkt zu FlowVault ohne Zusatzserver (ideal für LAN / Tailscale)
  3. **Periodischer Sync** über WorkManager
- **Android-Benachrichtigungen** mit `MessagingStyle`, 4 Kanälen (`Kritisch`, `Fehlläufe`, `Änderungen`, `Dienst`), Sperrbildschirm-Privatsphäre und Direktaktionen (`Als gelesen`, `1h stumm`, `Ausblenden`)

## Lokal bauen & testen

Voraussetzungen: JDK 17 und Android SDK 35 (`ANDROID_HOME`).

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

Die fertige Debug-APK liegt anschließend unter:
`android/app/build/outputs/apk/debug/app-debug.apk`

Per ADB installieren:
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
