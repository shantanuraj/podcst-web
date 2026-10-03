plugins {
    id("podcst.android.library")
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
}

android {
    namespace = "app.podcst.database"
}

room {
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    api(project(":core:model"))
    api(libs.room.runtime)
    api(libs.kotlinx.coroutines.core)
    ksp(libs.room.compiler)
    testImplementation(libs.robolectric)
    testImplementation(libs.room.testing)
    testImplementation(libs.turbine)
    testImplementation(libs.androidx.junit)
}
