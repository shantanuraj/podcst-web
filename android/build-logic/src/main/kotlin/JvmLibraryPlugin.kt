import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

class JvmLibraryPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("org.jetbrains.kotlin.jvm")
        configureKotlin()
        dependencies {
            add("testImplementation", libs.library("junit"))
            add("testImplementation", libs.library("kotlinx-coroutines-test"))
        }
    }
}
