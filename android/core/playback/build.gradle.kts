plugins {
    id("podcst.android.library")
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.podcst.playback"
    testOptions.unitTests.all {
        it.systemProperty("podcst.contracts", rootProject.file("../contracts").absolutePath)
    }
}

dependencies {
    api(project(":core:model"))
    api(project(":core:data"))
    implementation(project(":core:audio-engine"))
    api(libs.media3.exoplayer)
    api(libs.media3.session)
    implementation(libs.media3.datasource.okhttp)
    api(libs.media3.cast)
    implementation(libs.kotlinx.coroutines.guava)
    testImplementation(libs.robolectric)
    testImplementation(libs.turbine)
    testImplementation(libs.media3.test.utils)
    testImplementation(libs.androidx.junit)
}
