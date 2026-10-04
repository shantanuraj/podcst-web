plugins {
    id("podcst.jvm.library")
    `java-test-fixtures`
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(project(":core:model"))
    api(libs.okhttp)
    api(libs.kotlinx.coroutines.core)
    testImplementation(libs.okhttp.mockwebserver)
    testFixturesImplementation(libs.kotlinx.coroutines.core)
}

tasks.test {
    systemProperty("podcst.contracts", rootProject.layout.projectDirectory.dir("../contracts").asFile.absolutePath)
}
