import com.android.build.api.dsl.CommonExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.getByType

class AndroidComposePlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
        extensions.getByType<CommonExtension>().buildFeatures.compose = true
        dependencies {
            add("implementation", libs.library("compose-ui"))
            add("implementation", libs.library("compose-foundation"))
            add("implementation", libs.library("compose-animation"))
            add("implementation", libs.library("compose-material3"))
            add("implementation", libs.library("compose-ui-tooling-preview"))
            add("debugImplementation", libs.library("compose-ui-tooling"))
            add("debugImplementation", libs.library("compose-ui-test-manifest"))
            add("androidTestImplementation", libs.library("compose-ui-test-junit4"))
        }
    }
}
