pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "podcst"

include(
    ":app",
    ":core:model",
    ":core:network",
    ":core:database",
    ":core:data",
    ":core:artwork",
    ":core:audio-engine",
    ":core:playback",
    ":core:designsystem",
    ":feature:discover",
    ":feature:library",
    ":feature:podcast",
    ":feature:player",
    ":feature:settings",
    ":feature:auth",
)
