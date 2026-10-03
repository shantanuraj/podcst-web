import com.android.build.api.dsl.CommonExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinBaseExtension
import org.jetbrains.kotlin.gradle.dsl.KotlinJvmCompilerOptions
import org.jetbrains.kotlin.gradle.dsl.HasConfigurableKotlinCompilerOptions

internal object Podcst {
    const val COMPILE_SDK = 37
    const val MIN_SDK = 33
    const val TARGET_SDK = 37
    val JAVA = JavaVersion.VERSION_17
}

internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

internal fun VersionCatalog.library(alias: String) = findLibrary(alias).get()

internal fun Project.configureAndroid(android: CommonExtension) {
    android.compileSdk = Podcst.COMPILE_SDK
    android.defaultConfig.minSdk = Podcst.MIN_SDK
    android.defaultConfig.testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    android.compileOptions.sourceCompatibility = Podcst.JAVA
    android.compileOptions.targetCompatibility = Podcst.JAVA
    configureKotlin()
}

internal fun Project.configureKotlin() {
    extensions.getByType<KotlinBaseExtension>().jvmToolchain(17)
    @Suppress("UNCHECKED_CAST")
    (extensions.getByName("kotlin") as HasConfigurableKotlinCompilerOptions<KotlinJvmCompilerOptions>)
        .compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}
