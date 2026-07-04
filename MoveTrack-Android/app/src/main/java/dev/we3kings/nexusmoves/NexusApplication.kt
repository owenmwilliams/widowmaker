package dev.we3kings.nexusmoves

import android.app.Application
import android.content.Context
import dev.we3kings.nexusmoves.data.auth.TokenStore

/**
 * Process entry point. Holds the application Context so singletons that mirror
 * iOS `.shared` services (TokenStore, the client-event logger) can reach it
 * without threading a Context through every call site. Registered via
 * android:name in the manifest.
 */
class NexusApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        appContext = this
        TokenStore.init(this)
    }

    companion object {
        lateinit var appContext: Context
            private set
    }
}
