plugins {
    `kotlin-dsl`
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    compileOnly(libs.android.gradle.plugin)
    compileOnly(libs.kotlin.gradle.plugin)
    compileOnly(libs.compose.gradle.plugin)
}

gradlePlugin {
    plugins {
        register("jvmLibrary") {
            id = "podcst.jvm.library"
            implementationClass = "JvmLibraryPlugin"
        }
        register("androidLibrary") {
            id = "podcst.android.library"
            implementationClass = "AndroidLibraryPlugin"
        }
        register("androidCompose") {
            id = "podcst.android.compose"
            implementationClass = "AndroidComposePlugin"
        }
        register("androidFeature") {
            id = "podcst.android.feature"
            implementationClass = "AndroidFeaturePlugin"
        }
    }
}
