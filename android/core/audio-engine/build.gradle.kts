import com.android.build.api.variant.DeviceTestBuilder
import com.android.build.api.variant.HostTestBuilder

plugins {
    id("podcst.android.library")
}

abstract class BridgeVectors : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val engine: RegularFileProperty

    @get:Input
    abstract val cases: ListProperty<String>

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @get:Inject
    abstract val execOperations: ExecOperations

    @TaskAction
    fun generate() {
        execOperations.exec {
            commandLine(
                listOf(engine.get().asFile.path, "bridge-vectors", outputDirectory.get().asFile.path) + cases.get(),
            )
        }
    }
}

val abis = listOf("arm64-v8a", "armeabi-v7a", "x86_64")
val cmakeVersion = "3.30.3"
val engineDirectory = rootProject.layout.projectDirectory.dir("../audio-engine")
val rustTargetDirectory = engineDirectory.dir("target")
val cppDirectory = layout.projectDirectory.dir("src/main/cpp")
val rustToolchain = providers.gradleProperty("podcst.rustToolchain").orNull
val cargoBin = providers.environmentVariable("CARGO_HOME")
    .orElse(providers.systemProperty("user.home").map { "$it/.cargo" })
    .get() + "/bin"
val hostJniDirectory = layout.buildDirectory.dir("host-jni")
val hostJniLibrary = hostJniDirectory.map { it.file(System.mapLibraryName("podcst_audio_jni")) }
val engineBinary = rustTargetDirectory.file("release/audio-engine")
val cmakeArguments = listOf(
    "-DPODCST_RUST_TARGET_DIR=${rustTargetDirectory.asFile.path}",
    "-DPODCST_AUDIO_INCLUDE_DIR=${engineDirectory.dir("include").asFile.path}",
)

android {
    namespace = "app.podcst.audio"
    ndkVersion = "30.0.16248370"
    defaultConfig {
        ndk.abiFilters += abis
        externalNativeBuild.cmake.arguments += cmakeArguments
    }
    externalNativeBuild.cmake {
        path = file("src/main/cpp/CMakeLists.txt")
        version = cmakeVersion
    }
}

dependencies {
    api(libs.media3.common)
    testImplementation(libs.kotlinx.serialization.json)
    androidTestImplementation(libs.kotlinx.serialization.json)
}

fun Exec.cargo(vararg arguments: String) {
    inputs.files(engineDirectory.dir("src"), engineDirectory.file("Cargo.toml"), engineDirectory.file("Cargo.lock"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.property("rustToolchain", rustToolchain.orEmpty())
    rustToolchain?.let { environment("RUSTUP_TOOLCHAIN", it) }
    environment("PATH", cargoBin + File.pathSeparator + providers.environmentVariable("PATH").get())
    commandLine(*arguments)
}

val buildRustAndroid = tasks.register<Exec>("buildRustAndroid") {
    val script = engineDirectory.file("scripts/build-android.sh")
    inputs.file(script)
    outputs.files(abis.map { rustTargetDirectory.file("android/$it/libpodcst_audio_engine.a") })
    cargo(script.asFile.path, "--target-dir", rustTargetDirectory.asFile.path, *abis.toTypedArray())
}

val buildRustHost = tasks.register<Exec>("buildRustHost") {
    outputs.files(rustTargetDirectory.file("release/libpodcst_audio_engine.a"), engineBinary)
    cargo(
        "$cargoBin/cargo", "build", "--locked", "--release",
        "--manifest-path", engineDirectory.file("Cargo.toml").asFile.path,
        "--target-dir", rustTargetDirectory.asFile.path,
    )
}

val sdkCmake = androidComponents.sdkComponents.sdkDirectory.map { it.dir("cmake/$cmakeVersion/bin") }

val configureHostJni = tasks.register<Exec>("configureHostJni") {
    val javaHome = javaToolchains.launcherFor { languageVersion = JavaLanguageVersion.of(17) }
        .map { it.metadata.installationPath.asFile.path }
    inputs.file(cppDirectory.file("CMakeLists.txt"))
    outputs.file(hostJniDirectory.map { it.file("build.ninja") })
    commandLine(
        listOf(
            sdkCmake.get().file("cmake").asFile.path,
            "-S", cppDirectory.asFile.path,
            "-B", hostJniDirectory.get().asFile.path,
            "-G", "Ninja",
            "-DCMAKE_MAKE_PROGRAM=${sdkCmake.get().file("ninja").asFile.path}",
            "-DCMAKE_BUILD_TYPE=Release",
            "-DPODCST_JAVA_HOME=${javaHome.get()}",
        ) + cmakeArguments,
    )
}

val buildHostJni = tasks.register<Exec>("buildHostJni") {
    dependsOn(buildRustHost, configureHostJni)
    inputs.files(cppDirectory, engineDirectory.dir("include"), rustTargetDirectory.file("release/libpodcst_audio_engine.a"))
    outputs.file(hostJniLibrary)
    commandLine(sdkCmake.get().file("cmake").asFile.path, "--build", hostJniDirectory.get().asFile.path)
}

val bridgeVectors = tasks.register<BridgeVectors>("bridgeVectors") {
    dependsOn(buildRustHost)
    engine.set(engineBinary)
    cases.set(emptyList())
    outputDirectory.set(layout.buildDirectory.dir("bridge-vectors/all"))
}

val deviceBridgeVectors = tasks.register<BridgeVectors>("deviceBridgeVectors") {
    dependsOn(buildRustHost)
    engine.set(engineBinary)
    cases.set(
        listOf(
            "effects-mono-8000-both",
            "effects-stereo-8000-revision-seek",
            "effects-stereo-8000-trim-pcm16",
            "limiter-stereo-8000-single-frame",
        ),
    )
}

androidComponents.onVariants { variant ->
    val hostTest = variant.hostTests[HostTestBuilder.UNIT_TEST_TYPE]?.sources
    val deviceTest = variant.deviceTests[DeviceTestBuilder.ANDROID_TEST_TYPE]?.sources
    listOfNotNull(hostTest, deviceTest).forEach { it.kotlin?.addStaticSourceDirectory("src/sharedTest/kotlin") }
    deviceTest?.assets?.addGeneratedSourceDirectory(deviceBridgeVectors, BridgeVectors::outputDirectory)
}

tasks.matching { it.name.startsWith("configureCMake") || it.name.startsWith("buildCMake") }.configureEach {
    dependsOn(buildRustAndroid)
}

tasks.withType<Test>().configureEach {
    testLogging.exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    dependsOn(buildHostJni)
    inputs.file(hostJniLibrary)
    inputs.dir(bridgeVectors.flatMap { it.outputDirectory })
    systemProperty("java.library.path", hostJniDirectory.get().asFile.path)
    systemProperty("podcst.audio.vectors", bridgeVectors.get().outputDirectory.get().asFile.path)
    maxHeapSize = "1g"
}
