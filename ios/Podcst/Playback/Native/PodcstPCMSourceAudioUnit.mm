#import "PodcstPCMSourceAudioUnit.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AUAudioUnitImplementation.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <vector>

static_assert(std::atomic<uint64_t>::is_always_lock_free);

namespace {

constexpr uint32_t MaximumCapacity = 1048576;

struct RenderContext {
    std::vector<float> ring;
    std::vector<float> outputPlanar;
    std::atomic<uint64_t> written{0};
    std::atomic<uint64_t> consumed{0};
    std::atomic<uint64_t> rendered{0};
    std::atomic<uint64_t> underruns{0};
    std::atomic<uint64_t> failures{0};
    uint32_t capacity = 0;
    uint32_t channels = 0;
    uint32_t maximumFrames = 0;
    bool prepared = false;

    void reset() {
        written.store(0, std::memory_order_relaxed);
        consumed.store(0, std::memory_order_relaxed);
        rendered.store(0, std::memory_order_relaxed);
        underruns.store(0, std::memory_order_relaxed);
        failures.store(0, std::memory_order_relaxed);
    }

    void release() {
        prepared = false;
        std::vector<float>().swap(ring);
        std::vector<float>().swap(outputPlanar);
        capacity = 0;
        maximumFrames = 0;
        reset();
    }

    bool prepare(uint32_t channelCount, uint32_t capacityFrames, uint32_t maximum) {
        release();
        channels = channelCount;
        capacity = capacityFrames;
        maximumFrames = maximum;
        try {
            ring.assign(static_cast<size_t>(channels) * capacity, 0);
            outputPlanar.assign(static_cast<size_t>(channels) * maximumFrames, 0);
        } catch (const std::bad_alloc &) {
            release();
            return false;
        }
        prepared = true;
        return true;
    }

    uint32_t availableFrames() const {
        const uint64_t read = consumed.load(std::memory_order_acquire);
        const uint64_t write = written.load(std::memory_order_acquire);
        return static_cast<uint32_t>(std::min<uint64_t>(capacity, write - std::min(write, read)));
    }

    bool enqueue(const float *const *input, uint32_t frames) {
        if (!prepared || !input) { return false; }
        for (uint32_t channel = 0; channel < channels; ++channel) { if (!input[channel]) { return false; } }
        const uint64_t read = consumed.load(std::memory_order_acquire);
        const uint64_t write = written.load(std::memory_order_relaxed);
        if (frames > capacity - (write - read) || write > std::numeric_limits<uint64_t>::max() - frames) { return false; }
        const uint32_t offset = static_cast<uint32_t>(write % capacity);
        const uint32_t first = std::min(frames, capacity - offset);
        for (uint32_t channel = 0; channel < channels; ++channel) {
            float *destination = ring.data() + static_cast<size_t>(channel) * capacity;
            std::memcpy(destination + offset, input[channel], first * sizeof(float));
            std::memcpy(destination, input[channel] + first, (frames - first) * sizeof(float));
        }
        written.store(write + frames, std::memory_order_release);
        return true;
    }

    uint64_t allocatedBytes() const {
        return sizeof(RenderContext) + (ring.capacity() + outputPlanar.capacity()) * sizeof(float);
    }

    AUAudioUnitStatus render(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp, uint32_t frames,
                             NSInteger bus, AudioBufferList *output) {
        if (!prepared) { return kAudioUnitErr_Uninitialized; }
        if (frames > maximumFrames) { return kAudioUnitErr_TooManyFramesToProcess; }
        if (!flags || !timestamp || bus != 0 || !output || output->mNumberBuffers != channels) { return kAudio_ParamError; }
        for (uint32_t channel = 0; channel < channels; ++channel) {
            const AudioBuffer &buffer = output->mBuffers[channel];
            if (buffer.mNumberChannels != 1 || (buffer.mData && buffer.mDataByteSize < frames * sizeof(float))) { return kAudio_ParamError; }
        }
        const uint64_t read = consumed.load(std::memory_order_relaxed);
        const uint64_t write = written.load(std::memory_order_acquire);
        const uint32_t count = static_cast<uint32_t>(std::min<uint64_t>(frames, write - read));
        const uint32_t offset = static_cast<uint32_t>(read % capacity);
        const uint32_t first = std::min(count, capacity - offset);
        bool silent = true;
        for (uint32_t channel = 0; channel < channels; ++channel) {
            AudioBuffer &buffer = output->mBuffers[channel];
            if (!buffer.mData) { buffer.mData = outputPlanar.data() + channel * maximumFrames; }
            buffer.mDataByteSize = frames * sizeof(float);
            auto *destination = static_cast<float *>(buffer.mData);
            const float *source = ring.data() + static_cast<size_t>(channel) * capacity;
            std::memcpy(destination, source + offset, first * sizeof(float));
            std::memcpy(destination + first, source, (count - first) * sizeof(float));
            std::fill_n(destination + count, frames - count, 0);
            for (uint32_t frame = 0; frame < count; ++frame) { silent = silent && destination[frame] == 0; }
        }
        consumed.store(read + count, std::memory_order_release);
        rendered.fetch_add(frames, std::memory_order_release);
        underruns.fetch_add(frames - count, std::memory_order_release);
        if (silent) { *flags |= kAudioUnitRenderAction_OutputIsSilence; }
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

@implementation PodcstPCMSourceAudioUnit {
    AUAudioUnitBusArray *_inputs;
    AUAudioUnitBusArray *_outputs;
    std::unique_ptr<RenderContext> _context;
    uint32_t _capacityFrames;
}

+ (AudioComponentDescription)componentDescription { return {kAudioUnitType_Generator, 'pPcm', 'Pdcs', 0, 0}; }

+ (void)registerAudioUnit {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        [AUAudioUnit registerSubclass:self asComponentDescription:[self componentDescription] name:@"Podcst: PCM Source" version:1];
    });
}

- (instancetype)initWithComponentDescription:(AudioComponentDescription)description options:(AudioComponentInstantiationOptions)options error:(NSError **)error {
    self = [super initWithComponentDescription:description options:options error:error];
    if (self) {
        _context.reset(new (std::nothrow) RenderContext());
        if (!_context) { SetError(error, kAudio_MemFullError); return nil; }
        _capacityFrames = 16384;
        self.maximumFramesToRender = 4096;
        AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:48000 channels:2];
        AUAudioUnitBus *output = [[AUAudioUnitBus alloc] initWithFormat:format error:error];
        if (!output) { return nil; }
        output.maximumChannelCount = 2;
        _inputs = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeInput busses:@[]];
        _outputs = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeOutput busses:@[output]];
    }
    return self;
}

- (AUAudioUnitBusArray *)inputBusses { return _inputs; }
- (AUAudioUnitBusArray *)outputBusses { return _outputs; }
- (NSArray<NSNumber *> *)channelCapabilities { return @[@0, @1, @0, @2]; }
- (uint32_t)capacityFrames { return _capacityFrames; }
- (uint32_t)availableFrames { return _context->availableFrames(); }
- (uint32_t)freeFrames { return _context->capacity - _context->availableFrames(); }
- (uint64_t)consumedFrameCount { return _context->consumed.load(std::memory_order_acquire); }
- (uint64_t)enqueuedFrameCount { return _context->written.load(std::memory_order_acquire); }
- (uint64_t)renderedFrameCount { return _context->rendered.load(std::memory_order_acquire); }
- (uint64_t)underrunFrameCount { return _context->underruns.load(std::memory_order_acquire); }
- (uint64_t)allocatedBytes { return _context->allocatedBytes(); }
- (uint64_t)renderFailureCount { return _context->failures.load(std::memory_order_acquire); }

- (BOOL)configureCapacityFrames:(uint32_t)frames error:(NSError **)error {
    if (self.renderResourcesAllocated) { return SetError(error, kAudioUnitErr_Initialized); }
    if (frames == 0 || frames > MaximumCapacity) { return SetError(error, kAudio_ParamError); }
    _capacityFrames = frames;
    return YES;
}

- (BOOL)enqueueBuffer:(AVAudioPCMBuffer *)buffer {
    if (!_context->prepared || ![buffer.format isEqual:_outputs[0].format]) { return NO; }
    return _context->enqueue(buffer.floatChannelData, buffer.frameLength);
}

- (BOOL)shouldChangeToFormat:(AVAudioFormat *)format forBus:(AUAudioUnitBus *)bus {
    return SupportedFormat(format) && [super shouldChangeToFormat:format forBus:bus];
}

- (BOOL)allocateRenderResourcesAndReturnError:(NSError **)error {
    if (self.renderResourcesAllocated) { return YES; }
    AVAudioFormat *format = _outputs[0].format;
    if (!SupportedFormat(format) || self.maximumFramesToRender == 0 || self.maximumFramesToRender > 8192) { return SetError(error, kAudioUnitErr_FormatNotSupported); }
    if (!_context->prepare(format.channelCount, _capacityFrames, self.maximumFramesToRender)) { return SetError(error, kAudio_MemFullError); }
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
    return ^AUAudioUnitStatus(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp, AUAudioFrameCount frames, NSInteger bus, AudioBufferList *output, const AURenderEvent *, AURenderPullInputBlock __unsafe_unretained) {
        const AUAudioUnitStatus status = context->render(flags, timestamp, frames, bus, output);
        if (status != noErr) { context->failures.fetch_add(1, std::memory_order_release); }
        return status;
    };
}

@end
