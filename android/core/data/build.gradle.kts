plugins {
    id("podcst.android.library")
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.podcst.data"
}

dependencies {
    api(project(":core:model"))
    api(project(":core:network"))
    api(project(":core:database"))
    api(libs.kotlinx.coroutines.android)
    implementation(libs.datastore.preferences)
    implementation(libs.work.runtime)
    testImplementation(libs.robolectric)
    testImplementation(libs.turbine)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.work.testing)
    testImplementation(libs.androidx.junit)
}
