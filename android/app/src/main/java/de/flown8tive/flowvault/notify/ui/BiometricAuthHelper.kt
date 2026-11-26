package de.flown8tive.flowvault.notify.ui

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Öffnet den nativen Android-Biometrie-/Gerätesperr-Dialog, bevor der Hardware-Schlüssel
 * im Android Keystore die Einmal-Challenge für ein Rollback signiert.
 */
object BiometricAuthHelper {
    private const val ALLOWED_AUTHENTICATORS = BIOMETRIC_STRONG or BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    fun authenticateForRollback(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        description: String,
        onAuthorized: () -> Unit,
        onError: (String) -> Unit,
    ) {
        val bm = BiometricManager.from(activity)
        val canAuth = bm.canAuthenticate(ALLOWED_AUTHENTICATORS)
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            onError("Bitte zuerst Fingerabdruck, Gesichtserkennung oder Displaysperre (PIN/Muster) in Android einrichten.")
            return
        }

        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onAuthorized()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED && errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        onError(errString.toString())
                    }
                }
            },
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setDescription(description)
            .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
            .build()

        prompt.authenticate(info)
    }
}
