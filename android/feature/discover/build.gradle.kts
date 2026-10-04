plugins {
    id("podcst.android.feature")
}

android {
    namespace = "app.podcst.feature.discover"
}

dependencies {
    testImplementation(libs.robolectric)
}
