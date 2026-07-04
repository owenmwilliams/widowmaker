plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "dev.we3kings.nexusmoves"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.we3kings.nexusmoves"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        // API base URL per build type — the parity of iOS Constants.apiBaseURL,
        // which pins prod for both DEBUG and RELEASE but leaves a commented local
        // line. Here debug points at the same Cloud Run backend by default (so a
        // plain `assembleDebug` talks to the live API and real OTP emails work);
        // flip DEBUG_API_URL to your Mac's LAN IP for local backend dev.
        // A real device can't reach 127.0.0.1 — use the LAN IP (e.g.
        // http://192.168.1.20:3050). The emulator reaches the host at 10.0.2.2.
        debug {
            buildConfigField("String", "API_BASE_URL", "\"https://movetrack-api-7hwn7ggbiq-uc.a.run.app\"")
            // buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3050\"") // local backend (emulator)
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", "\"https://movetrack-api-7hwn7ggbiq-uc.a.run.app\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    // Thumbnails in the review card (parity of iOS AsyncImage).
    implementation("io.coil-kt:coil-compose:2.7.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Token storage (Keychain equivalent)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Walkthrough video compression before upload (iOS gets 720p free from
    // UIImagePickerController; Android must transcode explicitly)
    implementation("androidx.media3:media3-transformer:1.5.0")
    implementation("androidx.media3:media3-effect:1.5.0")
    implementation("androidx.media3:media3-common:1.5.0")

    testImplementation("junit:junit:4.13.2")
}
