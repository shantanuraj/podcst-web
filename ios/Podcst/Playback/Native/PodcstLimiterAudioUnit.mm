#import "PodcstLimiterAudioUnit.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AUAudioUnitImplementation.h>
#import "podcst_audio.h"

#include <algorithm>
#include <atomic>
#include <array>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <new>
#include <vector>
#include <mach/mach_time.h>

static_assert(std::atomic<uint64_t>::is_always_lock_free);
static_assert(std::atomic<bool>::is_always_lock_free);
static_assert(std::atomic<int32_t>::is_always_lock_free);

namespace {

struct TelemetryPacket {
    PodcstOutputTelemetryInfo info = {};
    uint64_t storageStart = 0;
};

struct RenderContext {
    static constexpr uint32_t telemetryCapacity = 32768;
    static constexpr uint32_t packetCapacity = 64;
    std::vector<float> telemetrySamples;
    std::array<TelemetryPacket, packetCapacity> telemetryPackets;
    std::atomic<bool> telemetryEnabled{false};
    std::atomic<uint64_t> telemetryReadPacket{0};
    std::atomic<uint64_t> telemetryWritePacket{0};
    std::atomic<uint64_t> telemetryReadFrame{0};
    std::atomic<uint64_t> droppedTelemetryFrames{0};
    uint64_t telemetryWriteFrame = 0;
    PodcstAudioProcessor *processor = nullptr;
    AudioBufferList *inputList = nullptr;
    std::vector<float> inputPlanar;
    std::vector<float> outputPlanar;
    std::vector<float> interleaved;
    std::vector<float> processed;
    std::atomic<bool> drainRequested{false};
    std::atomic<bool> drained{false};
    std::atomic<uint64_t> renderedFrames{0};
    std::atomic<uint64_t> inputFrames{0};
    std::atomic<uint64_t> emittedFrames{0};
    std::atomic<uint64_t> firstRenderHostTime{0};
    std::atomic<uint64_t> firstRenderHostFrameOffset{0};
    std::atomic<uint64_t> renderFailures{0};
    std::atomic<int32_t> lastRenderStatus{noErr};
    std::atomic<bool> performanceDiagnosticsEnabled{false};
    std::atomic<uint64_t> diagnosticsEpoch{0};
    std::atomic<uint64_t> diagnosticCallbacks{0};
    std::atomic<uint64_t> diagnosticFrames{0};
    std::atomic<uint64_t> diagnosticSilentFrames{0};
    std::atomic<uint64_t> diagnosticFailedFrames{0};
    std::atomic<uint64_t> callbackGapCandidates{0};
    std::atomic<uint64_t> sampleTimeDiscontinuities{0};
    std::atomic<uint64_t> maximumCallbackIntervalNanos{0};
    std::atomic<uint64_t> maximumCallbackOverrunNanos{0};
    std::atomic<uint64_t> maximumSampleTimeDiscontinuityFrames{0};
    uint64_t observedDiagnosticsEpoch = 0;
    uint64_t previousCallbackTime = 0;
    uint32_t previousCallbackFrames = 0;
    double expectedSampleTime = 0;
    bool hasExpectedSampleTime = false;
    double hostTimeNanos = 0;
    uint32_t channels = 0;
    uint32_t maximumFrames = 0;
    uint32_t latencyFrames = 0;
    uint32_t primingFrames = 0;
    uint64_t processorBytes = 0;
    double sampleRate = 0;
    bool prepared = false;

    ~RenderContext() {
        release();
    }

    void release() {
        prepared = false;
        podcst_audio_destroy(&processor);
        free(inputList);
        inputList = nullptr;
        std::vector<float>().swap(inputPlanar);
        std::vector<float>().swap(outputPlanar);
        std::vector<float>().swap(interleaved);
        std::vector<float>().swap(processed);
        std::vector<float>().swap(telemetrySamples);
        maximumFrames = 0;
        latencyFrames = 0;
        processorBytes = 0;
        resetCounters();
    }

    void resetCounters() {
        telemetryReadPacket.store(0, std::memory_order_relaxed);
        telemetryWritePacket.store(0, std::memory_order_relaxed);
        telemetryReadFrame.store(0, std::memory_order_relaxed);
        droppedTelemetryFrames.store(0, std::memory_order_relaxed);
        telemetryWriteFrame = 0;
        primingFrames = latencyFrames;
        drainRequested.store(false, std::memory_order_relaxed);
        drained.store(false, std::memory_order_relaxed);
        renderedFrames.store(0, std::memory_order_relaxed);
        inputFrames.store(0, std::memory_order_relaxed);
        emittedFrames.store(0, std::memory_order_relaxed);
        firstRenderHostTime.store(0, std::memory_order_relaxed);
        firstRenderHostFrameOffset.store(0, std::memory_order_relaxed);
        renderFailures.store(0, std::memory_order_relaxed);
        lastRenderStatus.store(noErr, std::memory_order_relaxed);
        diagnosticCallbacks.store(0, std::memory_order_relaxed);
        diagnosticFrames.store(0, std::memory_order_relaxed);
        diagnosticSilentFrames.store(0, std::memory_order_relaxed);
        diagnosticFailedFrames.store(0, std::memory_order_relaxed);
        callbackGapCandidates.store(0, std::memory_order_relaxed);
        sampleTimeDiscontinuities.store(0, std::memory_order_relaxed);
        maximumCallbackIntervalNanos.store(0, std::memory_order_relaxed);
        maximumCallbackOverrunNanos.store(0, std::memory_order_relaxed);
        maximumSampleTimeDiscontinuityFrames.store(0, std::memory_order_relaxed);
        previousCallbackTime = 0;
        previousCallbackFrames = 0;
        hasExpectedSampleTime = false;
    }

    bool prepare(double rate, uint32_t channelCount, uint32_t maximum, bool limiterEnabled) {
        release();
        sampleRate = rate;
        mach_timebase_info_data_t timebase = {};
        mach_timebase_info(&timebase);
        hostTimeNanos = double(timebase.numer) / timebase.denom;
        channels = channelCount;
        maximumFrames = maximum;
        PodcstAudioConfig config;
        podcst_audio_config_default(&config);
        config.sample_rate = static_cast<uint32_t>(rate);
        config.channels = channels;
        config.limiter_enabled = limiterEnabled ? 1 : 0;
        if (podcst_audio_create(&config, &processor) != PODCST_AUDIO_OK) {
            release();
            return false;
        }
        PodcstAudioInfo info;
        if (podcst_audio_get_info(processor, &info) != PODCST_AUDIO_OK) {
            release();
            return false;
        }
        latencyFrames = info.latency_frames;
        processorBytes = info.allocated_bytes;
        const size_t sampleCount = static_cast<size_t>(channels) * maximumFrames;
        try {
            inputPlanar.assign(sampleCount, 0);
            outputPlanar.assign(sampleCount, 0);
            interleaved.assign(sampleCount, 0);
            processed.assign(sampleCount, 0);
            telemetrySamples.assign(static_cast<size_t>(telemetryCapacity) * channels, 0);
        } catch (const std::bad_alloc &) {
            release();
            return false;
        }
        inputList = static_cast<AudioBufferList *>(calloc(1, offsetof(AudioBufferList, mBuffers) + channels * sizeof(AudioBuffer)));
        if (!inputList) {
            release();
            return false;
        }
        resetCounters();
        prepared = true;
        return true;
    }

    uint64_t allocatedBytes() const {
        return processorBytes + sizeof(RenderContext)
            + (inputPlanar.capacity() + outputPlanar.capacity() + interleaved.capacity() + processed.capacity() + telemetrySamples.capacity()) * sizeof(float)
            + (inputList ? offsetof(AudioBufferList, mBuffers) + channels * sizeof(AudioBuffer) : 0);
    }

    static void storeMaximum(std::atomic<uint64_t> &value, uint64_t candidate) {
        if (candidate > value.load(std::memory_order_relaxed)) {
            value.store(candidate, std::memory_order_relaxed);
        }
    }

    bool beginDiagnostics(const AudioTimeStamp *timestamp, uint32_t frames) {
        if (!performanceDiagnosticsEnabled.load(std::memory_order_acquire)) { return false; }
        const auto epoch = diagnosticsEpoch.load(std::memory_order_acquire);
        if (epoch != observedDiagnosticsEpoch) {
            observedDiagnosticsEpoch = epoch;
            previousCallbackTime = 0;
            hasExpectedSampleTime = false;
        }
        const uint64_t now = mach_absolute_time();
        if (previousCallbackTime != 0 && now >= previousCallbackTime && sampleRate > 0) {
            const double interval = double(now - previousCallbackTime) * hostTimeNanos;
            const double expected = double(previousCallbackFrames) / sampleRate * 1e9;
            storeMaximum(maximumCallbackIntervalNanos, uint64_t(interval));
            if (interval > expected) {
                storeMaximum(maximumCallbackOverrunNanos, uint64_t(interval - expected));
                if (interval - expected > std::max(2e6, expected * 0.5)) {
                    callbackGapCandidates.fetch_add(1, std::memory_order_relaxed);
                }
            }
        }
        previousCallbackTime = now;
        previousCallbackFrames = frames;
        if (timestamp && (timestamp->mFlags & kAudioTimeStampSampleTimeValid) && std::isfinite(timestamp->mSampleTime)) {
            if (hasExpectedSampleTime) {
                const double difference = std::abs(timestamp->mSampleTime - expectedSampleTime);
                if (difference > 1) {
                    sampleTimeDiscontinuities.fetch_add(1, std::memory_order_relaxed);
                    storeMaximum(maximumSampleTimeDiscontinuityFrames, uint64_t(std::min(std::ceil(difference), double(UINT64_MAX / 2))));
                }
            }
            expectedSampleTime = timestamp->mSampleTime + frames;
            hasExpectedSampleTime = true;
        } else {
            hasExpectedSampleTime = false;
        }
        diagnosticCallbacks.fetch_add(1, std::memory_order_relaxed);
        diagnosticFrames.fetch_add(frames, std::memory_order_relaxed);
        return true;
    }

    void finishDiagnostics(AUAudioUnitStatus status, AudioUnitRenderActionFlags *flags, uint32_t frames) {
        if (status != noErr) {
            diagnosticFailedFrames.fetch_add(frames, std::memory_order_relaxed);
        } else if (flags && (*flags & kAudioUnitRenderAction_OutputIsSilence)) {
            diagnosticSilentFrames.fetch_add(frames, std::memory_order_relaxed);
        }
    }

    void captureOutput(AudioBufferList *output, uint32_t frames, uint64_t outputStartFrame) {
        if (!telemetryEnabled.load(std::memory_order_relaxed) || frames == 0) { return; }
        const uint64_t writePacket = telemetryWritePacket.load(std::memory_order_relaxed);
        if (writePacket - telemetryReadPacket.load(std::memory_order_acquire) >= packetCapacity
            || telemetryWriteFrame - telemetryReadFrame.load(std::memory_order_acquire) + frames > telemetryCapacity) {
            droppedTelemetryFrames.fetch_add(frames, std::memory_order_relaxed);
            return;
        }
        for (uint32_t frame = 0; frame < frames; ++frame) {
            const uint64_t storageFrame = (telemetryWriteFrame + frame) % telemetryCapacity;
            for (uint32_t channel = 0; channel < channels; ++channel) {
                telemetrySamples[storageFrame * channels + channel] = static_cast<float *>(output->mBuffers[channel].mData)[frame];
            }
        }
        PodcstAudioInfo processorInfo = {};
        podcst_audio_get_info(processor, &processorInfo);
        telemetryPackets[writePacket % packetCapacity] = {
            {outputStartFrame, frames, channels, sampleRate, processorInfo.limiter_reduction_db}, telemetryWriteFrame
        };
        telemetryWriteFrame += frames;
        telemetryWritePacket.store(writePacket + 1, std::memory_order_release);
    }

    uint32_t copyTelemetry(float *samples, uint32_t capacity, uint64_t throughOutputFrame, PodcstOutputTelemetryInfo *info) {
        if (!samples || !info) { return 0; }
        const uint64_t readPacket = telemetryReadPacket.load(std::memory_order_relaxed);
        if (readPacket == telemetryWritePacket.load(std::memory_order_acquire)) { return 0; }
        const auto &packet = telemetryPackets[readPacket % packetCapacity];
        if (capacity < packet.info.frameCount || packet.info.outputStartFrame + packet.info.frameCount > throughOutputFrame) { return 0; }
        *info = packet.info;
        for (uint32_t frame = 0; frame < info->frameCount; ++frame) {
            const uint64_t storageFrame = (packet.storageStart + frame) % telemetryCapacity;
            for (uint32_t channel = 0; channel < info->channels; ++channel) {
                samples[frame * info->channels + channel] = telemetrySamples[storageFrame * info->channels + channel];
            }
        }
        telemetryReadFrame.store(packet.storageStart + info->frameCount, std::memory_order_release);
        telemetryReadPacket.store(readPacket + 1, std::memory_order_release);
        return info->frameCount;
    }

    AUAudioUnitStatus prepareOutput(AudioBufferList *output, uint32_t frames) {
        if (!output || output->mNumberBuffers != channels) {
            return kAudio_ParamError;
        }
        for (uint32_t channel = 0; channel < channels; ++channel) {
            const AudioBuffer &buffer = output->mBuffers[channel];
            if (buffer.mNumberChannels != 1 || (buffer.mData && buffer.mDataByteSize < frames * sizeof(float))) {
                return kAudio_ParamError;
            }
        }
        for (uint32_t channel = 0; channel < channels; ++channel) {
            AudioBuffer &buffer = output->mBuffers[channel];
            if (!buffer.mData) {
                buffer.mData = outputPlanar.data() + channel * maximumFrames;
            }
            buffer.mDataByteSize = frames * sizeof(float);
        }
        return noErr;
    }

    void writeOutput(AudioUnitRenderActionFlags *flags, AudioBufferList *output, uint32_t frames, uint32_t prefixFrames, uint32_t contentFrames) {
        bool silent = true;
        for (uint32_t channel = 0; channel < channels; ++channel) {
            auto *destination = static_cast<float *>(output->mBuffers[channel].mData);
            for (uint32_t frame = 0; frame < frames; ++frame) {
                const float value = frame >= prefixFrames && frame - prefixFrames < contentFrames
                    ? processed[(frame - prefixFrames) * channels + channel] : 0;
                destination[frame] = value;
                silent = silent && value == 0;
            }
        }
        if (silent) {
            *flags |= kAudioUnitRenderAction_OutputIsSilence;
        } else {
            *flags &= ~kAudioUnitRenderAction_OutputIsSilence;
        }
    }

    AUAudioUnitStatus render(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp, uint32_t frames, NSInteger bus, AudioBufferList *output, AURenderPullInputBlock __unsafe_unretained pullInput) {
        if (!prepared) {
            return kAudioUnitErr_Uninitialized;
        }
        if (frames > maximumFrames) {
            return kAudioUnitErr_TooManyFramesToProcess;
        }
        if (!flags || !timestamp || bus != 0) {
            return kAudio_ParamError;
        }
        const auto outputStatus = prepareOutput(output, frames);
        if (outputStatus != noErr) {
            return outputStatus;
        }
        PodcstAudioReport report = {};
        uint32_t prefix = 0;
        bool complete = false;
        if (drainRequested.load(std::memory_order_acquire)) {
            if (inputFrames.load(std::memory_order_relaxed) == 0) {
                primingFrames = 0;
            }
            prefix = std::min(primingFrames, frames);
            primingFrames -= prefix;
            const uint32_t status = podcst_audio_finish(processor, processed.data(), frames - prefix, &report);
            if (status != PODCST_AUDIO_OUTPUT_FULL && status != PODCST_AUDIO_FINISHED) {
                writeOutput(flags, output, frames, 0, 0);
                return kAudioUnitErr_CannotDoInCurrentContext;
            }
            complete = status == PODCST_AUDIO_FINISHED;
        } else {
            if (!pullInput) {
                writeOutput(flags, output, frames, 0, 0);
                return kAudioUnitErr_NoConnection;
            }
            inputList->mNumberBuffers = channels;
            for (uint32_t channel = 0; channel < channels; ++channel) {
                inputList->mBuffers[channel] = {1, frames * static_cast<uint32_t>(sizeof(float)), inputPlanar.data() + channel * maximumFrames};
            }
            AudioUnitRenderActionFlags inputFlags = *flags & ~kAudioUnitRenderAction_OutputIsSilence;
            const AUAudioUnitStatus pullStatus = pullInput(&inputFlags, timestamp, frames, 0, inputList);
            if (pullStatus != noErr) {
                writeOutput(flags, output, frames, 0, 0);
                return pullStatus;
            }
            if (inputList->mNumberBuffers != channels) {
                writeOutput(flags, output, frames, 0, 0);
                return kAudio_ParamError;
            }
            const bool inputSilent = inputFlags & kAudioUnitRenderAction_OutputIsSilence;
            for (uint32_t channel = 0; channel < channels; ++channel) {
                const AudioBuffer &buffer = inputList->mBuffers[channel];
                if (buffer.mNumberChannels != 1 || (!inputSilent && (!buffer.mData || buffer.mDataByteSize < frames * sizeof(float)))) {
                    writeOutput(flags, output, frames, 0, 0);
                    return kAudio_ParamError;
                }
                const auto *source = static_cast<const float *>(buffer.mData);
                for (uint32_t frame = 0; frame < frames; ++frame) {
                    interleaved[frame * channels + channel] = inputSilent ? 0 : source[frame];
                }
            }
            const uint32_t status = podcst_audio_process(processor, interleaved.data(), frames, processed.data(), frames, &report);
            if (status != PODCST_AUDIO_OK || report.consumed_frames != frames || report.emitted_frames > frames) {
                writeOutput(flags, output, frames, 0, 0);
                return kAudioUnitErr_CannotDoInCurrentContext;
            }
            prefix = frames - report.emitted_frames;
            if (prefix > primingFrames) {
                writeOutput(flags, output, frames, 0, 0);
                return kAudioUnitErr_CannotDoInCurrentContext;
            }
            primingFrames -= prefix;
            inputFrames.fetch_add(report.consumed_frames, std::memory_order_relaxed);
        }
        writeOutput(flags, output, frames, prefix, report.emitted_frames);
        emittedFrames.fetch_add(report.emitted_frames, std::memory_order_relaxed);
        const uint64_t renderStart = renderedFrames.fetch_add(frames, std::memory_order_relaxed);
        captureOutput(output, frames, renderStart);
        if (frames > 0 && firstRenderHostTime.load(std::memory_order_relaxed) == 0
            && (timestamp->mFlags & kAudioTimeStampHostTimeValid) && timestamp->mHostTime != 0) {
            firstRenderHostFrameOffset.store(renderStart, std::memory_order_relaxed);
            firstRenderHostTime.store(timestamp->mHostTime, std::memory_order_release);
        }
        drained.store(complete, std::memory_order_release);
        return noErr;
    }
};

BOOL SetError(NSError **error, OSStatus status) {
    if (error) {
        *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    }
    return NO;
}

bool SupportedFormat(AVAudioFormat *format) {
    return format.commonFormat == AVAudioPCMFormatFloat32 && !format.interleaved
        && (format.channelCount == 1 || format.channelCount == 2)
        && std::isfinite(format.sampleRate) && format.sampleRate >= 8000 && format.sampleRate <= 192000
        && std::floor(format.sampleRate) == format.sampleRate;
}

}

@implementation PodcstLimiterAudioUnit {
    AUAudioUnitBus *_inputBus;
    AUAudioUnitBus *_outputBus;
    AUAudioUnitBusArray *_inputs;
    AUAudioUnitBusArray *_outputs;
    std::unique_ptr<RenderContext> _context;
    BOOL _limiterEnabled;
}

+ (AudioComponentDescription)componentDescription {
    return {kAudioUnitType_Effect, 'pLmt', 'Pdcs', 0, 0};
}

+ (void)registerAudioUnit {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        [AUAudioUnit registerSubclass:self asComponentDescription:[self componentDescription] name:@"Podcst: Final Limiter" version:1];
    });
}

- (instancetype)initWithComponentDescription:(AudioComponentDescription)description options:(AudioComponentInstantiationOptions)options error:(NSError **)error {
    self = [super initWithComponentDescription:description options:options error:error];
    if (self) {
        _context.reset(new (std::nothrow) RenderContext());
        if (!_context) {
            SetError(error, kAudio_MemFullError);
            return nil;
        }
        _limiterEnabled = YES;
        self.maximumFramesToRender = 4096;
        AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:48000 channels:2];
        _inputBus = [[AUAudioUnitBus alloc] initWithFormat:format error:error];
        _outputBus = [[AUAudioUnitBus alloc] initWithFormat:format error:error];
        if (!_inputBus || !_outputBus) {
            return nil;
        }
        _inputBus.maximumChannelCount = 2;
        _outputBus.maximumChannelCount = 2;
        _inputs = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeInput busses:@[_inputBus]];
        _outputs = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeOutput busses:@[_outputBus]];
    }
    return self;
}

- (AUAudioUnitBusArray *)inputBusses { return _inputs; }
- (AUAudioUnitBusArray *)outputBusses { return _outputs; }
- (NSArray<NSNumber *> *)channelCapabilities { return @[@1, @1, @2, @2]; }
- (BOOL)limiterEnabled { return _limiterEnabled; }
- (AUAudioFrameCount)latencyFrames { return _context->latencyFrames; }
- (NSTimeInterval)latency { return _context->sampleRate > 0 ? _context->latencyFrames / _context->sampleRate : 0; }
- (uint64_t)renderedFrameCount { return _context->renderedFrames.load(std::memory_order_relaxed); }
- (uint64_t)inputFrameCount { return _context->inputFrames.load(std::memory_order_relaxed); }
- (uint64_t)emittedFrameCount { return _context->emittedFrames.load(std::memory_order_relaxed); }
- (uint64_t)firstRenderHostTime { return _context->firstRenderHostTime.load(std::memory_order_acquire); }
- (uint64_t)firstRenderHostFrameOffset { return _context->firstRenderHostFrameOffset.load(std::memory_order_relaxed); }
- (uint64_t)allocatedBytes { return _context->allocatedBytes(); }
- (uint64_t)renderFailureCount { return _context->renderFailures.load(std::memory_order_acquire); }
- (OSStatus)lastRenderStatus { return _context->lastRenderStatus.load(std::memory_order_relaxed); }
- (BOOL)isDrained { return _context->drained.load(std::memory_order_acquire); }
- (BOOL)telemetryEnabled { return _context->telemetryEnabled.load(std::memory_order_relaxed); }
- (void)setTelemetryEnabled:(BOOL)enabled { _context->telemetryEnabled.store(enabled, std::memory_order_relaxed); }
- (uint64_t)droppedTelemetryFrames { return _context->droppedTelemetryFrames.load(std::memory_order_relaxed); }
- (BOOL)performanceDiagnosticsEnabled { return _context->performanceDiagnosticsEnabled.load(std::memory_order_relaxed); }
- (void)setPerformanceDiagnosticsEnabled:(BOOL)enabled {
    if (_context->performanceDiagnosticsEnabled.load(std::memory_order_relaxed) != enabled) {
        _context->diagnosticsEpoch.fetch_add(1, std::memory_order_release);
        _context->performanceDiagnosticsEnabled.store(enabled, std::memory_order_release);
    }
}
- (PodcstRenderDiagnostics)renderDiagnostics {
    return {
        _context->diagnosticCallbacks.load(std::memory_order_relaxed),
        _context->diagnosticFrames.load(std::memory_order_relaxed),
        _context->diagnosticSilentFrames.load(std::memory_order_relaxed),
        _context->diagnosticFailedFrames.load(std::memory_order_relaxed),
        _context->callbackGapCandidates.load(std::memory_order_relaxed),
        _context->sampleTimeDiscontinuities.load(std::memory_order_relaxed),
        double(_context->maximumCallbackIntervalNanos.load(std::memory_order_relaxed)) / 1e9,
        double(_context->maximumCallbackOverrunNanos.load(std::memory_order_relaxed)) / 1e9,
        double(_context->maximumSampleTimeDiscontinuityFrames.load(std::memory_order_relaxed))
    };
}

- (uint32_t)copyTelemetryFrames:(float *)samples capacity:(uint32_t)capacity throughOutputFrame:(uint64_t)throughOutputFrame info:(PodcstOutputTelemetryInfo *)info {
    return _context->copyTelemetry(samples, capacity, throughOutputFrame, info);
}

- (BOOL)configureLimiterEnabled:(BOOL)enabled error:(NSError **)error {
    if (self.renderResourcesAllocated) {
        return SetError(error, kAudioUnitErr_Initialized);
    }
    _limiterEnabled = enabled;
    return YES;
}

- (BOOL)shouldChangeToFormat:(AVAudioFormat *)format forBus:(AUAudioUnitBus *)bus {
    return SupportedFormat(format) && [super shouldChangeToFormat:format forBus:bus];
}

- (BOOL)allocateRenderResourcesAndReturnError:(NSError **)error {
    if (self.renderResourcesAllocated) {
        return YES;
    }
    AVAudioFormat *input = _inputBus.format;
    AVAudioFormat *output = _outputBus.format;
    if (!SupportedFormat(input) || ![input isEqual:output]
        || self.maximumFramesToRender == 0 || self.maximumFramesToRender > PODCST_AUDIO_MAX_BLOCK_FRAMES) {
        return SetError(error, kAudioUnitErr_FormatNotSupported);
    }
    if (!_context->prepare(output.sampleRate, output.channelCount, self.maximumFramesToRender, _limiterEnabled)) {
        return SetError(error, kAudio_MemFullError);
    }
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
    if (_context->processor) {
        podcst_audio_reset(_context->processor);
    }
    _context->resetCounters();
}

- (void)beginDraining {
    _context->drainRequested.store(true, std::memory_order_release);
}

- (AUInternalRenderBlock)internalRenderBlock {
    RenderContext *context = _context.get();
    return ^AUAudioUnitStatus(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp, AUAudioFrameCount frames, NSInteger bus, AudioBufferList *output, const AURenderEvent *, AURenderPullInputBlock __unsafe_unretained pullInput) {
        const bool diagnostics = context->beginDiagnostics(timestamp, frames);
        const AUAudioUnitStatus status = context->render(flags, timestamp, frames, bus, output, pullInput);
        if (diagnostics) { context->finishDiagnostics(status, flags, frames); }
        if (status != noErr) {
            context->lastRenderStatus.store(status, std::memory_order_relaxed);
            context->renderFailures.fetch_add(1, std::memory_order_release);
        }
        return status;
    };
}

@end
