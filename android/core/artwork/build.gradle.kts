plugins {
    id("podcst.android.library")
}

android {
    namespace = "app.podcst.artwork"
}

dependencies {
    api(project(":core:model"))
    api(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.okhttp.mockwebserver)
}
