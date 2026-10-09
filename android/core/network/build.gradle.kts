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
    val contracts = rootProject.layout.projectDirectory.dir("../contracts")
    inputs.dir(contracts)
    systemProperty("podcst.contracts", contracts.asFile.absolutePath)
}
