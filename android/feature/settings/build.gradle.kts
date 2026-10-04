plugins {
    id("podcst.android.feature")
}

android {
    namespace = "app.podcst.feature.settings"
}

dependencies {
    implementation(libs.activity.compose)
    testImplementation(libs.robolectric)
    testImplementation(testFixtures(project(":core:network")))
}
