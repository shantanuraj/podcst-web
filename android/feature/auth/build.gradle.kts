plugins {
    id("podcst.android.feature")
}

android {
    namespace = "app.podcst.feature.auth"
}

dependencies {
    implementation(libs.credentials)
    implementation(libs.credentials.play.services)
    testImplementation(libs.robolectric)
    testImplementation(testFixtures(project(":core:network")))
}
