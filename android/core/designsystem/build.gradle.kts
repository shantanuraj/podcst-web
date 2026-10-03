plugins {
    id("podcst.android.library")
    id("podcst.android.compose")
}

android {
    namespace = "app.podcst.designsystem"
}

dependencies {
    api(project(":core:model"))
    api(libs.coil.compose)
    implementation(libs.core.ktx)
}
