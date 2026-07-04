package dev.we3kings.nexusmoves.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dev.we3kings.nexusmoves.data.Constants

/**
 * Session-token storage — port of iOS KeychainService. The token lives in
 * EncryptedSharedPreferences (AES-256, key in the Android Keystore), the
 * closest equivalent to the iOS Keychain. Initialized once from
 * NexusApplication.onCreate.
 */
object TokenStore {
    @Volatile private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs != null) return
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context.applicationContext,
            Constants.securePrefsFile,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private fun requirePrefs(): SharedPreferences =
        prefs ?: error("TokenStore.init(context) must run before use")

    var sessionToken: String?
        get() = requirePrefs().getString(Constants.sessionTokenKey, null)
        set(value) {
            requirePrefs().edit().apply {
                if (value == null) remove(Constants.sessionTokenKey)
                else putString(Constants.sessionTokenKey, value)
            }.apply()
        }

    val isLoggedIn: Boolean get() = sessionToken != null

    fun clear() {
        sessionToken = null
    }
}
