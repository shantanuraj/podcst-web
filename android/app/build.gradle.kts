plugins {
    alias(libs.plugins.android.application)
    id("podcst.android.compose")
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.podcst"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.podcst.android"
        minSdk = 33
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    val release = providers.gradleProperty("podcst.release.storeFile").orNull?.let { storeFile ->
        signingConfigs.create("release") {
            this.storeFile = file(storeFile)
            storePassword = providers.gradleProperty("podcst.release.storePassword").get()
            keyAlias = providers.gradleProperty("podcst.release.keyAlias").get()
            keyPassword = providers.gradleProperty("podcst.release.keyPassword").get()
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = release
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:network"))
    implementation(project(":core:data"))
    implementation(project(":core:playback"))
    implementation(project(":core:artwork"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:discover"))
    implementation(project(":feature:library"))
    implementation(project(":feature:podcast"))
    implementation(project(":feature:player"))
    implementation(project(":feature:settings"))
    implementation(project(":feature:auth"))
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.core.splashscreen)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.viewmodel.navigation3)
    implementation(libs.lifecycle.process)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.media3.session)
    implementation(libs.kotlinx.coroutines.guava)
    implementation(libs.profileinstaller)
    testImplementation(libs.junit)
}
