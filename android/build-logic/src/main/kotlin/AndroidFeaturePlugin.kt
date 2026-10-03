import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.project

class AndroidFeaturePlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("podcst.android.library")
        pluginManager.apply("podcst.android.compose")
        dependencies {
            add("implementation", project(":core:model"))
            add("implementation", project(":core:designsystem"))
            add("implementation", project(":core:data"))
            add("implementation", project(":core:playback"))
            add("implementation", libs.library("lifecycle-runtime-compose"))
            add("implementation", libs.library("lifecycle-viewmodel-compose"))
            add("implementation", libs.library("kotlinx-coroutines-android"))
            add("testImplementation", libs.library("turbine"))
        }
    }
}
