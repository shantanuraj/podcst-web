cmake_minimum_required(VERSION 3.22.1)
project(podcst_audio_jni LANGUAGES CXX)

if(ANDROID)
    set(rust_library ${PODCST_RUST_TARGET_DIR}/android/${ANDROID_ABI}/libpodcst_audio_engine.a)
else()
    set(rust_library ${PODCST_RUST_TARGET_DIR}/release/libpodcst_audio_engine.a)
endif()

add_library(podcst_audio_engine STATIC IMPORTED)
set_target_properties(podcst_audio_engine PROPERTIES IMPORTED_LOCATION ${rust_library})

add_library(podcst_audio_jni SHARED podcst_audio_jni.cpp)
target_compile_features(podcst_audio_jni PRIVATE cxx_std_20)
target_compile_options(podcst_audio_jni PRIVATE
    -Wall -Wextra -Werror -fno-exceptions -fno-rtti -fvisibility=hidden)
target_include_directories(podcst_audio_jni PRIVATE ${PODCST_AUDIO_INCLUDE_DIR})
target_link_libraries(podcst_audio_jni PRIVATE podcst_audio_engine)

if(ANDROID)
    target_link_libraries(podcst_audio_jni PRIVATE log dl m)
    target_link_options(podcst_audio_jni PRIVATE -Wl,--gc-sections -Wl,--exclude-libs,ALL)
elseif(APPLE)
    target_include_directories(podcst_audio_jni PRIVATE
        ${PODCST_JAVA_HOME}/include ${PODCST_JAVA_HOME}/include/darwin)
    target_link_options(podcst_audio_jni PRIVATE -Wl,-dead_strip)
else()
    target_include_directories(podcst_audio_jni PRIVATE
        ${PODCST_JAVA_HOME}/include ${PODCST_JAVA_HOME}/include/linux)
    target_link_libraries(podcst_audio_jni PRIVATE dl m pthread)
    target_link_options(podcst_audio_jni PRIVATE -Wl,--gc-sections)
endif()
