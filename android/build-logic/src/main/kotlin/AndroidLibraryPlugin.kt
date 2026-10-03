import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

class AndroidLibraryPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.library")
        extensions.configure<LibraryExtension> {
            configureAndroid(this)
            testOptions.unitTests.isIncludeAndroidResources = true
            testOptions.unitTests.isReturnDefaultValues = true
        }
        dependencies {
            add("testImplementation", libs.library("junit"))
            add("testImplementation", libs.library("kotlinx-coroutines-test"))
            add("androidTestImplementation", libs.library("androidx-junit"))
            add("androidTestImplementation", libs.library("androidx-test-runner"))
        }
    }
}
