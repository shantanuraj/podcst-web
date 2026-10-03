#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>

#include "podcst_audio.h"

namespace {

constexpr uint32_t kBusy = 7;
constexpr uint32_t kClosed = 8;

static_assert(sizeof(PodcstSourceSpan) == 16);
static_assert(offsetof(PodcstSourceSpan, source_start_frame) == 0);
static_assert(offsetof(PodcstSourceSpan, output_start_frame) == 8);
static_assert(offsetof(PodcstSourceSpan, frame_count) == 12);
static_assert(sizeof(PodcstEffectsInfo) == 48);
static_assert(offsetof(PodcstEffectsInfo, pending_frames) == 8);
static_assert(offsetof(PodcstEffectsInfo, boost_gain_db) == 20);
static_assert(offsetof(PodcstEffectsInfo, allocated_bytes) == 24);
static_assert(offsetof(PodcstEffectsInfo, applied_revision) == 32);
static_assert(offsetof(PodcstEffectsInfo, applied_source_frame) == 40);
static_assert(sizeof(PodcstAudioInfo) == 24);
static_assert(offsetof(PodcstAudioInfo, latency_frames) == 4);
static_assert(offsetof(PodcstAudioInfo, allocated_bytes) == 16);

enum class State { Idle, Busy, Closed };

template <typename Handle>
struct Shell {
    Handle* handle;
    const uint32_t channels;
    std::atomic<State> state;
};

using Effects = Shell<PodcstEffectsProcessor>;
using Limiter = Shell<PodcstAudioProcessor>;

struct Region {
    std::byte* data = nullptr;
    size_t bytes = 0;
    bool valid = false;
};

template <typename Handle>
Shell<Handle>& shell(jlong address) {
    return *reinterpret_cast<Shell<Handle>*>(static_cast<uintptr_t>(address));
}

jlong pack(uint32_t status, uint32_t consumed = 0, uint32_t emitted = 0, uint32_t spans = 0) {
    return static_cast<jlong>(status) | static_cast<jlong>(consumed) << 8 |
           static_cast<jlong>(emitted) << 24 | static_cast<jlong>(spans) << 40;
}

template <typename Handle>
jlong create(uint32_t status, Handle* handle, jint channels) {
    if (status != PODCST_AUDIO_OK) {
        return static_cast<jlong>(status);
    }
    return static_cast<jlong>(reinterpret_cast<uintptr_t>(
        new Shell<Handle>{handle, static_cast<uint32_t>(channels), State::Idle}));
}

template <typename Handle, typename Work>
jlong enter(jlong address, Work work) {
    Shell<Handle>& target = shell<Handle>(address);
    State expected = State::Idle;
    if (!target.state.compare_exchange_strong(expected, State::Busy, std::memory_order_acquire)) {
        return pack(expected == State::Closed ? kClosed : kBusy);
    }
    const jlong result = work(target);
    target.state.store(State::Idle, std::memory_order_release);
    return result;
}

template <typename Handle, uint32_t (*destroy)(Handle**)>
jint close(jlong address) {
    Shell<Handle>& target = shell<Handle>(address);
    State expected = State::Idle;
    if (target.state.compare_exchange_strong(expected, State::Closed, std::memory_order_acquire)) {
        return static_cast<jint>(destroy(&target.handle));
    }
    return static_cast<jint>(expected == State::Closed ? PODCST_AUDIO_OK : kBusy);
}

template <typename Handle, uint32_t (*destroy)(Handle**)>
void release(jlong address) {
    Shell<Handle>* target = &shell<Handle>(address);
    destroy(&target->handle);
    delete target;
}

Region region(JNIEnv* env, jobject buffer, jint offset, jint bytes, size_t alignment) {
    if (buffer == nullptr || offset < 0 || bytes < 0) {
        return {};
    }
    const jlong capacity = env->GetDirectBufferCapacity(buffer);
    if (capacity < 0 || static_cast<jlong>(offset) + bytes > capacity) {
        return {};
    }
    if (bytes == 0) {
        return {nullptr, 0, true};
    }
    auto* base = static_cast<std::byte*>(env->GetDirectBufferAddress(buffer));
    if (base == nullptr || reinterpret_cast<uintptr_t>(base + offset) % alignment != 0) {
        return {};
    }
    return {base + offset, static_cast<size_t>(bytes), true};
}

bool frames(const Region& region, uint32_t channels, uint32_t& count) {
    const size_t frame = sizeof(float) * channels;
    if (!region.valid || region.bytes % frame != 0) {
        return false;
    }
    count = static_cast<uint32_t>(
        std::min<size_t>(region.bytes / frame, PODCST_AUDIO_MAX_BLOCK_FRAMES));
    return true;
}

float* samples(const Region& region) {
    return reinterpret_cast<float*>(region.data);
}

PodcstSourceSpan* spans(const Region& region) {
    return reinterpret_cast<PodcstSourceSpan*>(region.data);
}

uint32_t span_capacity(const Region& region) {
    return static_cast<uint32_t>(
        std::min<size_t>(region.bytes / sizeof(PodcstSourceSpan), PODCST_AUDIO_MAX_BLOCK_FRAMES));
}

jlong effects_report(uint32_t status, const PodcstEffectsReport& report) {
    return pack(status, report.consumed_frames, report.emitted_frames, report.span_count);
}

jlong audio_report(uint32_t status, const PodcstAudioReport& report) {
    return pack(status, report.consumed_frames, report.emitted_frames);
}

}

extern "C" {

JNIEXPORT jlong JNICALL Java_app_podcst_audio_NativeAudio_effectsCreate(
    JNIEnv*, jclass, jint sample_rate, jint channels, jboolean boost, jboolean trim) {
    if (sample_rate < 0 || channels < 0) {
        return static_cast<jlong>(PODCST_AUDIO_INVALID_CONFIG);
    }
    PodcstEffectsConfig config;
    podcst_effects_config_default(&config);
    config.sample_rate = static_cast<uint32_t>(sample_rate);
    config.channels = static_cast<uint32_t>(channels);
    config.boost_enabled = boost ? 1 : 0;
    config.trim_enabled = trim ? 1 : 0;
    PodcstEffectsProcessor* handle = nullptr;
    return create(podcst_effects_create(&config, &handle), handle, channels);
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_effectsConfigure(
    JNIEnv*, jclass, jlong address, jboolean boost, jboolean trim, jlong revision) {
    return static_cast<jint>(enter<PodcstEffectsProcessor>(address, [&](Effects& effects) {
        return pack(podcst_effects_configure(
            effects.handle, boost ? 1 : 0, trim ? 1 : 0, static_cast<uint64_t>(revision)));
    }));
}

JNIEXPORT jlong JNICALL Java_app_podcst_audio_NativeAudio_effectsProcess(
    JNIEnv* env, jclass, jlong address, jobject input, jint input_offset, jint input_bytes,
    jobject output, jint output_offset, jint output_bytes, jobject span_buffer,
    jint span_bytes) {
    return enter<PodcstEffectsProcessor>(address, [&](Effects& effects) {
        const Region source = region(env, input, input_offset, input_bytes, alignof(float));
        const Region destination = region(env, output, output_offset, output_bytes, alignof(float));
        const Region span_region = region(env, span_buffer, 0, span_bytes, alignof(PodcstSourceSpan));
        uint32_t input_frames = 0;
        uint32_t output_frames = 0;
        if (!frames(source, effects.channels, input_frames) ||
            !frames(destination, effects.channels, output_frames) || !span_region.valid) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        PodcstEffectsReport report{};
        const uint32_t status = podcst_effects_process(
            effects.handle, samples(source), input_frames, samples(destination), output_frames,
            spans(span_region), span_capacity(span_region), &report);
        return effects_report(status, report);
    });
}

JNIEXPORT jlong JNICALL Java_app_podcst_audio_NativeAudio_effectsFinish(
    JNIEnv* env, jclass, jlong address, jobject output, jint output_offset, jint output_bytes,
    jobject span_buffer, jint span_bytes) {
    return enter<PodcstEffectsProcessor>(address, [&](Effects& effects) {
        const Region destination = region(env, output, output_offset, output_bytes, alignof(float));
        const Region span_region = region(env, span_buffer, 0, span_bytes, alignof(PodcstSourceSpan));
        uint32_t output_frames = 0;
        if (!frames(destination, effects.channels, output_frames) || !span_region.valid) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        PodcstEffectsReport report{};
        const uint32_t status =
            podcst_effects_finish(effects.handle, samples(destination), output_frames,
                                  spans(span_region), span_capacity(span_region), &report);
        return effects_report(status, report);
    });
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_effectsReset(
    JNIEnv*, jclass, jlong address, jlong origin) {
    return static_cast<jint>(enter<PodcstEffectsProcessor>(address, [&](Effects& effects) {
        if (origin < 0) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        return pack(podcst_effects_reset(effects.handle, static_cast<uint64_t>(origin)));
    }));
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_effectsInfo(
    JNIEnv* env, jclass, jlong address, jobject info) {
    return static_cast<jint>(enter<PodcstEffectsProcessor>(address, [&](Effects& effects) {
        const Region target =
            region(env, info, 0, sizeof(PodcstEffectsInfo), alignof(PodcstEffectsInfo));
        if (!target.valid) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        return pack(podcst_effects_get_info(
            effects.handle, reinterpret_cast<PodcstEffectsInfo*>(target.data)));
    }));
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_effectsClose(
    JNIEnv*, jclass, jlong address) {
    return close<PodcstEffectsProcessor, podcst_effects_destroy>(address);
}

JNIEXPORT void JNICALL Java_app_podcst_audio_NativeAudio_effectsRelease(
    JNIEnv*, jclass, jlong address) {
    release<PodcstEffectsProcessor, podcst_effects_destroy>(address);
}

JNIEXPORT jlong JNICALL Java_app_podcst_audio_NativeAudio_limiterCreate(
    JNIEnv*, jclass, jint sample_rate, jint channels) {
    if (sample_rate < 0 || channels < 0) {
        return static_cast<jlong>(PODCST_AUDIO_INVALID_CONFIG);
    }
    PodcstAudioConfig config;
    podcst_audio_config_default(&config);
    config.sample_rate = static_cast<uint32_t>(sample_rate);
    config.channels = static_cast<uint32_t>(channels);
    config.limiter_enabled = 1;
    PodcstAudioProcessor* handle = nullptr;
    return create(podcst_audio_create(&config, &handle), handle, channels);
}

JNIEXPORT jlong JNICALL Java_app_podcst_audio_NativeAudio_limiterProcess(
    JNIEnv* env, jclass, jlong address, jobject input, jint input_offset, jint input_bytes,
    jobject output, jint output_offset, jint output_bytes) {
    return enter<PodcstAudioProcessor>(address, [&](Limiter& limiter) {
        const Region source = region(env, input, input_offset, input_bytes, alignof(float));
        const Region destination = region(env, output, output_offset, output_bytes, alignof(float));
        uint32_t input_frames = 0;
        uint32_t output_frames = 0;
        if (!frames(source, limiter.channels, input_frames) ||
            !frames(destination, limiter.channels, output_frames)) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        PodcstAudioReport report{};
        const uint32_t status = podcst_audio_process(limiter.handle, samples(source), input_frames,
                                                     samples(destination), output_frames, &report);
        return audio_report(status, report);
    });
}

JNIEXPORT jlong JNICALL Java_app_podcst_audio_NativeAudio_limiterFinish(
    JNIEnv* env, jclass, jlong address, jobject output, jint output_offset, jint output_bytes) {
    return enter<PodcstAudioProcessor>(address, [&](Limiter& limiter) {
        const Region destination = region(env, output, output_offset, output_bytes, alignof(float));
        uint32_t output_frames = 0;
        if (!frames(destination, limiter.channels, output_frames)) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        PodcstAudioReport report{};
        const uint32_t status =
            podcst_audio_finish(limiter.handle, samples(destination), output_frames, &report);
        return audio_report(status, report);
    });
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_limiterReset(
    JNIEnv*, jclass, jlong address) {
    return static_cast<jint>(enter<PodcstAudioProcessor>(
        address, [](Limiter& limiter) { return pack(podcst_audio_reset(limiter.handle)); }));
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_limiterInfo(
    JNIEnv* env, jclass, jlong address, jobject info) {
    return static_cast<jint>(enter<PodcstAudioProcessor>(address, [&](Limiter& limiter) {
        const Region target =
            region(env, info, 0, sizeof(PodcstAudioInfo), alignof(PodcstAudioInfo));
        if (!target.valid) {
            return pack(PODCST_AUDIO_INVALID_ARGUMENT);
        }
        return pack(
            podcst_audio_get_info(limiter.handle, reinterpret_cast<PodcstAudioInfo*>(target.data)));
    }));
}

JNIEXPORT jint JNICALL Java_app_podcst_audio_NativeAudio_limiterClose(
    JNIEnv*, jclass, jlong address) {
    return close<PodcstAudioProcessor, podcst_audio_destroy>(address);
}

JNIEXPORT void JNICALL Java_app_podcst_audio_NativeAudio_limiterRelease(
    JNIEnv*, jclass, jlong address) {
    release<PodcstAudioProcessor, podcst_audio_destroy>(address);
}

}
