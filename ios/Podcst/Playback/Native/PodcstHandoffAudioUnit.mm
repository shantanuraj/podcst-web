#import "PodcstHandoffAudioUnit.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AUAudioUnitImplementation.h>
#include <mach/mach_time.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <vector>

static_assert(std::atomic<uint64_t>::is_always_lock_free);
static_assert(std::atomic<uint32_t>::is_always_lock_free);

namespace {

constexpr uint64_t StateMask = 3;
constexpr uint64_t Idle = 0;
constexpr uint64_t Writing = 1;
constexpr uint64_t Pending = 2;
constexpr uint64_t MaximumFrame = std::numeric_limits<uint64_t>::max() >> 2;

struct Transition {
    uint64_t primeFrame = 0;
    uint64_t fadeFrame = 0;
    uint64_t endFrame = 0;
    uint32_t input = 0;
    uint32_t fadeFrames = 0;
};

struct RenderContext {
    std::array<AudioBufferList *, 2> inputLists{};
    std::array<std::vector<float>, 2> inputPlanar;
    std::vector<float> outputPlanar;
    std::atomic<uint64_t> control{Idle};
    std::atomic<uint64_t> renderedFrames{0};
    std::atomic<uint64_t> renderFailures{0};
    std::atomic<uint32_t> activeInput{0};
    Transition command;
    uint32_t channels = 0;
    uint32_t maximumFrames = 0;
    double ticksPerFrame = 0;
    bool prepared = false;

    ~RenderContext() { release(); }

    void reset() {
        command = {};
        control.store(Idle, std::memory_order_relaxed);
        renderedFrames.store(0, std::memory_order_relaxed);
        renderFailures.store(0, std::memory_order_relaxed);
        activeInput.store(0, std::memory_order_relaxed);
    }

    void release() {
        prepared = false;
        for (auto &list : inputLists) {
            free(list);
            list = nullptr;
        }
        for (auto &samples : inputPlanar) { std::vector<float>().swap(samples); }
        std::vector<float>().swap(outputPlanar);
        maximumFrames = 0;
        reset();
    }

    bool prepare(double sampleRate, uint32_t channelCount, uint32_t maximum) {
        release();
        channels = channelCount;
        maximumFrames = maximum;
        mach_timebase_info_data_t timebase;
        if (mach_timebase_info(&timebase) != KERN_SUCCESS || timebase.numer == 0) { return false; }
        ticksPerFrame = 1e9 * timebase.denom / timebase.numer / sampleRate;
        const size_t sampleCount = static_cast<size_t>(channels) * maximumFrames;
        try {
            for (auto &samples : inputPlanar) { samples.assign(sampleCount, 0); }
            outputPlanar.assign(sampleCount, 0);
        } catch (const std::bad_alloc &) {
            release();
            return false;
        }
        for (auto &list : inputLists) {
            list = static_cast<AudioBufferList *>(calloc(1, offsetof(AudioBufferList, mBuffers) + channels * sizeof(AudioBuffer)));
            if (!list) { release(); return false; }
        }
        prepared = true;
        return true;
    }

    uint64_t allocatedBytes() const {
        uint64_t bytes = sizeof(RenderContext) + outputPlanar.capacity() * sizeof(float);
        for (size_t input = 0; input < inputLists.size(); ++input) {
            bytes += inputPlanar[input].capacity() * sizeof(float);
            if (inputLists[input]) { bytes += offsetof(AudioBufferList, mBuffers) + channels * sizeof(AudioBuffer); }
        }
        return bytes;
    }

    bool schedule(uint32_t input, uint64_t primeFrame, uint64_t fadeFrame, uint32_t fadeFrames) {
        if (!prepared || input > 1 || fadeFrames == 0 || fadeFrame < primeFrame
            || fadeFrame > MaximumFrame - fadeFrames) { return false; }
        uint64_t state = control.load(std::memory_order_acquire);
        do {
            if ((state & StateMask) != Idle || primeFrame < (state >> 2)
                || input == activeInput.load(std::memory_order_acquire)) { return false; }
        } while (!control.compare_exchange_weak(state, state | Writing, std::memory_order_acq_rel, std::memory_order_acquire));
        command = {primeFrame, fadeFrame, fadeFrame + fadeFrames, input, fadeFrames};
        state |= Writing;
        do {
            if (primeFrame < (state >> 2)) {
                control.fetch_and(~StateMask, std::memory_order_release);
                return false;
            }
        } while (!control.compare_exchange_weak(state, (state & ~StateMask) | Pending, std::memory_order_acq_rel, std::memory_order_acquire));
        return true;
    }

    AUAudioUnitStatus prepareOutput(AudioBufferList *output, uint32_t frames) {
        if (!output || output->mNumberBuffers != channels) { return kAudio_ParamError; }
        for (uint32_t channel = 0; channel < channels; ++channel) {
            const AudioBuffer &buffer = output->mBuffers[channel];
            if (buffer.mNumberChannels != 1 || (buffer.mData && buffer.mDataByteSize < frames * sizeof(float))) { return kAudio_ParamError; }
        }
        for (uint32_t channel = 0; channel < channels; ++channel) {
            AudioBuffer &buffer = output->mBuffers[channel];
            if (!buffer.mData) { buffer.mData = outputPlanar.data() + channel * maximumFrames; }
            buffer.mDataByteSize = frames * sizeof(float);
        }
        return noErr;
    }

    AUAudioUnitStatus pull(uint32_t input, const AudioTimeStamp *timestamp, uint32_t offset, uint32_t frames,
                           AudioUnitRenderActionFlags flags, bool &silent, AURenderPullInputBlock __unsafe_unretained pullInput) {
        AudioBufferList *list = inputLists[input];
        list->mNumberBuffers = channels;
        for (uint32_t channel = 0; channel < channels; ++channel) {
            list->mBuffers[channel] = {1, frames * static_cast<uint32_t>(sizeof(float)), inputPlanar[input].data() + channel * maximumFrames};
        }
        AudioTimeStamp stamp = *timestamp;
        if (stamp.mFlags & kAudioTimeStampSampleTimeValid) { stamp.mSampleTime += offset; }
        if (stamp.mFlags & kAudioTimeStampHostTimeValid) { stamp.mHostTime += static_cast<uint64_t>(std::llround(offset * ticksPerFrame)); }
        flags &= ~kAudioUnitRenderAction_OutputIsSilence;
        const AUAudioUnitStatus status = pullInput(&flags, &stamp, frames, input, list);
        if (status != noErr) { return status; }
        if (list->mNumberBuffers != channels) { return kAudio_ParamError; }
        silent = flags & kAudioUnitRenderAction_OutputIsSilence;
        for (uint32_t channel = 0; channel < channels; ++channel) {
            AudioBuffer &buffer = list->mBuffers[channel];
            if (buffer.mNumberChannels != 1 || (!silent && (!buffer.mData || buffer.mDataByteSize < frames * sizeof(float)))) { return kAudio_ParamError; }
            auto *destination = inputPlanar[input].data() + channel * maximumFrames;
            if (!silent && buffer.mData != destination) { std::memmove(destination, buffer.mData, frames * sizeof(float)); }
            buffer.mData = destination;
        }
        return noErr;
    }

    AUAudioUnitStatus render(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp, uint32_t frames,
                             NSInteger bus, AudioBufferList *output, AURenderPullInputBlock __unsafe_unretained pullInput) {
        if (!prepared) { return kAudioUnitErr_Uninitialized; }
        if (frames > maximumFrames) { return kAudioUnitErr_TooManyFramesToProcess; }
        if (!flags || !timestamp || bus != 0) { return kAudio_ParamError; }
        const AUAudioUnitStatus outputStatus = prepareOutput(output, frames);
        if (outputStatus != noErr) { return outputStatus; }
        if (!pullInput && frames > 0) { return kAudioUnitErr_NoConnection; }
        if (renderedFrames.load(std::memory_order_relaxed) > MaximumFrame - frames) { return kAudioUnitErr_CannotDoInCurrentContext; }
        const uint64_t state = control.fetch_add(static_cast<uint64_t>(frames) << 2, std::memory_order_acq_rel);
        const uint64_t start = state >> 2;
        const bool pending = (state & StateMask) == Pending;
        const Transition transition = pending ? command : Transition{};
        const uint32_t previousInput = activeInput.load(std::memory_order_relaxed);
        bool outputSilent = true;
        bool completed = false;
        uint32_t offset = 0;
        while (offset < frames) {
            const uint64_t position = start + offset;
            uint64_t boundary = start + frames;
            if (pending) {
                for (uint64_t next : {transition.primeFrame, transition.fadeFrame, transition.endFrame}) {
                    if (next > position) { boundary = std::min(boundary, next); }
                }
            }
            const uint32_t count = static_cast<uint32_t>(boundary - position);
            const bool finished = pending && position >= transition.endFrame;
            const bool priming = pending && position >= transition.primeFrame;
            const bool fading = pending && position >= transition.fadeFrame;
            const uint32_t mainInput = finished ? transition.input : previousInput;
            bool mainSilent = false;
            bool targetSilent = true;
            AUAudioUnitStatus status = pull(mainInput, timestamp, offset, count, *flags, mainSilent, pullInput);
            if (status == noErr && priming && !finished) {
                status = pull(transition.input, timestamp, offset, count, *flags, targetSilent, pullInput);
            }
            if (status != noErr) {
                for (uint32_t channel = 0; channel < channels; ++channel) {
                    std::fill_n(static_cast<float *>(output->mBuffers[channel].mData), frames, 0);
                }
                *flags |= kAudioUnitRenderAction_OutputIsSilence;
                control.fetch_sub(static_cast<uint64_t>(frames) << 2, std::memory_order_release);
                return status;
            }
            for (uint32_t channel = 0; channel < channels; ++channel) {
                auto *destination = static_cast<float *>(output->mBuffers[channel].mData) + offset;
                const auto *main = static_cast<const float *>(inputLists[mainInput]->mBuffers[channel].mData);
                const auto *target = pending ? static_cast<const float *>(inputLists[transition.input]->mBuffers[channel].mData) : nullptr;
                for (uint32_t frame = 0; frame < count; ++frame) {
                    float value = mainSilent ? 0 : main[frame];
                    if (fading && !finished) {
                        const float weight = transition.fadeFrames == 1 ? 1 : static_cast<float>(position + frame - transition.fadeFrame) / (transition.fadeFrames - 1);
                        value = value * (1 - weight) + (targetSilent ? 0 : target[frame]) * weight;
                    }
                    destination[frame] = value;
                    outputSilent = outputSilent && value == 0;
                }
            }
            offset += count;
            completed = pending && start + offset >= transition.endFrame;
        }
        renderedFrames.store(start + frames, std::memory_order_release);
        if (completed) {
            activeInput.store(transition.input, std::memory_order_release);
            control.fetch_and(~StateMask, std::memory_order_release);
        }
        if (outputSilent) { *flags |= kAudioUnitRenderAction_OutputIsSilence; }
        else { *flags &= ~kAudioUnitRenderAction_OutputIsSilence; }
        return noErr;
    }
};

BOOL SetError(NSError **error, OSStatus status) {
    if (error) { *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil]; }
    return NO;
}

bool SupportedFormat(AVAudioFormat *format) {
    return format.commonFormat == AVAudioPCMFormatFloat32 && !format.interleaved
        && (format.channelCount == 1 || format.channelCount == 2)
        && std::isfinite(format.sampleRate) && format.sampleRate >= 8000 && format.sampleRate <= 192000
        && std::floor(format.sampleRate) == format.sampleRate;
}

}

@implementation PodcstHandoffAudioUnit {
    AUAudioUnitBusArray *_inputs;
    AUAudioUnitBusArray *_outputs;
    std::unique_ptr<RenderContext> _context;
}

+ (AudioComponentDescription)componentDescription { return {kAudioUnitType_Mixer, 'pHnd', 'Pdcs', 0, 0}; }

+ (void)registerAudioUnit {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        [AUAudioUnit registerSubclass:self asComponentDescription:[self componentDescription] name:@"Podcst: Playback Handoff" version:1];
    });
}

- (instancetype)initWithComponentDescription:(AudioComponentDescription)description options:(AudioComponentInstantiationOptions)options error:(NSError **)error {
    self = [super initWithComponentDescription:description options:options error:error];
    if (self) {
        _context.reset(new (std::nothrow) RenderContext());
        if (!_context) { SetError(error, kAudio_MemFullError); return nil; }
        self.maximumFramesToRender = 4096;
        AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:48000 channels:2];
        AUAudioUnitBus *first = [[AUAudioUnitBus alloc] initWithFormat:format error:error];
        AUAudioUnitBus *second = [[AUAudioUnitBus alloc] initWithFormat:format error:error];
        AUAudioUnitBus *output = [[AUAudioUnitBus alloc] initWithFormat:format error:error];
        if (!first || !second || !output) { return nil; }
        first.maximumChannelCount = second.maximumChannelCount = output.maximumChannelCount = 2;
        _inputs = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeInput busses:@[first, second]];
        _outputs = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeOutput busses:@[output]];
    }
    return self;
}

- (AUAudioUnitBusArray *)inputBusses { return _inputs; }
- (AUAudioUnitBusArray *)outputBusses { return _outputs; }
- (NSArray<NSNumber *> *)channelCapabilities { return @[@1, @1, @2, @2]; }
- (uint64_t)renderedFrameCount { return _context->renderedFrames.load(std::memory_order_acquire); }
- (uint32_t)activeInput { return _context->activeInput.load(std::memory_order_acquire); }
- (BOOL)transitionPending { return (_context->control.load(std::memory_order_acquire) & StateMask) != Idle; }
- (uint64_t)allocatedBytes { return _context->allocatedBytes(); }
- (uint64_t)renderFailureCount { return _context->renderFailures.load(std::memory_order_acquire); }

- (BOOL)scheduleTransitionToInput:(uint32_t)input primeFrame:(uint64_t)primeFrame fadeFrame:(uint64_t)fadeFrame fadeFrames:(uint32_t)fadeFrames {
    return _context->schedule(input, primeFrame, fadeFrame, fadeFrames);
}

- (BOOL)shouldChangeToFormat:(AVAudioFormat *)format forBus:(AUAudioUnitBus *)bus {
    return SupportedFormat(format) && [super shouldChangeToFormat:format forBus:bus];
}

- (BOOL)allocateRenderResourcesAndReturnError:(NSError **)error {
    if (self.renderResourcesAllocated) { return YES; }
    AVAudioFormat *format = _outputs[0].format;
    if (!SupportedFormat(format) || ![format isEqual:_inputs[0].format] || ![format isEqual:_inputs[1].format]
        || self.maximumFramesToRender == 0 || self.maximumFramesToRender > 8192) { return SetError(error, kAudioUnitErr_FormatNotSupported); }
    if (!_context->prepare(format.sampleRate, format.channelCount, self.maximumFramesToRender)) { return SetError(error, kAudio_MemFullError); }
    if (![super allocateRenderResourcesAndReturnError:error]) {
        _context->release();
        [self setRenderResourcesAllocated:NO];
        return NO;
    }
    return YES;
}

- (void)deallocateRenderResources {
    _context->release();
    [super deallocateRenderResources];
}

- (void)reset {
    [super reset];
    _context->reset();
}

- (AUInternalRenderBlock)internalRenderBlock {
    RenderContext *context = _context.get();
    return ^AUAudioUnitStatus(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp, AUAudioFrameCount frames, NSInteger bus, AudioBufferList *output, const AURenderEvent *, AURenderPullInputBlock __unsafe_unretained pullInput) {
        const AUAudioUnitStatus status = context->render(flags, timestamp, frames, bus, output, pullInput);
        if (status != noErr) { context->renderFailures.fetch_add(1, std::memory_order_release); }
        return status;
    };
}

@end
