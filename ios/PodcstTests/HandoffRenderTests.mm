#import <XCTest/XCTest.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AUAudioUnitImplementation.h>
#import "PodcstHandoffAudioUnit.h"
#import "PodcstPCMSourceAudioUnit.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <thread>
#include <vector>

struct PodcstHandoffTestList {
    UInt32 count;
    AudioBuffer buffers[2];
};

struct PodcstHandoffTestPull {
    uint32_t input;
    uint64_t sample;
    uint32_t frames;
    uint64_t host;
};

@interface HandoffRenderTests : XCTestCase
@end

@implementation HandoffRenderTests

- (void)setUp {
    [super setUp];
    [PodcstHandoffAudioUnit registerAudioUnit];
    [PodcstPCMSourceAudioUnit registerAudioUnit];
}

- (PodcstHandoffAudioUnit *)unitWithChannels:(uint32_t)channels sampleRate:(uint32_t)rate maximumFrames:(uint32_t)frames {
    NSError *error = nil;
    auto *unit = [[PodcstHandoffAudioUnit alloc] initWithComponentDescription:[PodcstHandoffAudioUnit componentDescription] options:0 error:&error];
    XCTAssertNotNil(unit);
    XCTAssertNil(error);
    AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:rate channels:channels];
    XCTAssertTrue([unit.inputBusses[0] setFormat:format error:&error]);
    XCTAssertTrue([unit.inputBusses[1] setFormat:format error:&error]);
    XCTAssertTrue([unit.outputBusses[0] setFormat:format error:&error]);
    unit.maximumFramesToRender = frames;
    XCTAssertTrue([unit allocateRenderResourcesAndReturnError:&error]);
    XCTAssertNil(error);
    return error ? nil : unit;
}

- (void)testExactPrimingAndFadeBoundariesAcrossIrregularRenderSlices {
    for (uint32_t channels : {1, 2}) {
        for (uint32_t rate : {8000, 44100, 48000, 192000}) {
            auto *unit = [self unitWithChannels:channels sampleRate:rate maximumFrames:17];
            if (!unit) { return; }
            XCTAssertEqual(unit.activeInput, 0);
            XCTAssertFalse(unit.transitionPending);
            XCTAssertTrue([unit scheduleTransitionToInput:1 primeFrame:5 fadeFrame:13 fadeFrames:9]);
            XCTAssertTrue(unit.transitionPending);
            std::vector<PodcstHandoffTestPull> pulls;
            auto *events = &pulls;
            std::array<uint64_t, 2> consumed{};
            auto *cursors = &consumed;
            const uint64_t initialHost = 123456789;
            auto pull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *stamp, AUAudioFrameCount count, NSInteger bus, AudioBufferList *buffers) {
                events->push_back({static_cast<uint32_t>(bus), static_cast<uint64_t>(stamp->mSampleTime), count, stamp->mHostTime});
                for (uint32_t channel = 0; channel < channels; ++channel) {
                    auto *samples = static_cast<float *>(buffers->mBuffers[channel].mData);
                    for (uint32_t frame = 0; frame < count; ++frame) { samples[frame] = bus == 0 ? 0.25f * (channel + 1) : -0.5f * (channel + 1); }
                }
                (*cursors)[bus] += count;
                return noErr;
            };
            auto render = unit.internalRenderBlock;
            uint64_t position = 0;
            const uint64_t bytes = unit.allocatedBytes;
            for (uint32_t frames : {3, 8, 17, 1, 9}) {
                float samples[34] = {};
                PodcstHandoffTestList list = {channels, {{1, frames * 4, samples}, {1, frames * 4, samples + 17}}};
                if (position == 11) { list.buffers[0].mData = nullptr; list.buffers[1].mData = nullptr; }
                AudioTimeStamp stamp = {};
                stamp.mSampleTime = position;
                stamp.mHostTime = initialHost + [AVAudioTime hostTimeForSeconds:static_cast<double>(position) / rate];
                stamp.mFlags = kAudioTimeStampSampleTimeValid | kAudioTimeStampHostTimeValid;
                AudioUnitRenderActionFlags flags = kAudioUnitRenderAction_OutputIsSilence;
                XCTAssertEqual(render(&flags, &stamp, frames, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
                XCTAssertEqual(flags & kAudioUnitRenderAction_OutputIsSilence, 0);
                for (uint32_t channel = 0; channel < channels; ++channel) {
                    auto *output = static_cast<float *>(list.buffers[channel].mData);
                    for (uint32_t frame = 0; frame < frames; ++frame) {
                        const uint64_t absolute = position + frame;
                        const float weight = absolute < 13 ? 0 : absolute >= 22 ? 1 : static_cast<float>(absolute - 13) / 8;
                        const float expected = (0.25f * (1 - weight) - 0.5f * weight) * (channel + 1);
                        XCTAssertEqualWithAccuracy(output[frame], expected, 1e-7);
                    }
                }
                position += frames;
                XCTAssertEqual(unit.renderedFrameCount, position);
                XCTAssertEqual(unit.transitionPending, position < 22);
                XCTAssertEqual(unit.activeInput, position < 22 ? 0 : 1);
                XCTAssertEqual(unit.allocatedBytes, bytes);
            }
            XCTAssertEqual(consumed[0], 22);
            XCTAssertEqual(consumed[1], position - 5);
            for (const auto &event : pulls) {
                if (event.input == 1) { XCTAssertGreaterThanOrEqual(event.sample, 5); }
                else { XCTAssertLessThanOrEqual(event.sample + event.frames, 22); }
                const uint64_t expectedHost = initialHost + [AVAudioTime hostTimeForSeconds:static_cast<double>(event.sample) / rate];
                XCTAssertLessThanOrEqual(std::abs(static_cast<int64_t>(event.host - expectedHost)), 1);
            }
            XCTAssertEqual(unit.renderFailureCount, 0);
            [unit deallocateRenderResources];
        }
    }
}

- (void)testRepeatedTransitionsPreserveInputOrderingAndDormantBranches {
    auto *unit = [self unitWithChannels:1 sampleRate:48000 maximumFrames:16];
    if (!unit) { return; }
    std::array<uint64_t, 2> consumed{};
    auto *cursors = &consumed;
    auto pull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount count, NSInteger bus, AudioBufferList *buffers) {
        auto *samples = static_cast<float *>(buffers->mBuffers[0].mData);
        for (uint32_t frame = 0; frame < count; ++frame) { samples[frame] = static_cast<float>((*cursors)[bus]++ + bus * 100); }
        return noErr;
    };
    auto render = unit.internalRenderBlock;
    float samples[16] = {};
    PodcstHandoffTestList list = {1, {{1, sizeof(samples), samples}, {}}};
    AudioTimeStamp stamp = {};
    stamp.mFlags = kAudioTimeStampSampleTimeValid;
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 4, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    XCTAssertEqual(consumed[0], 4);
    XCTAssertEqual(consumed[1], 0);
    XCTAssertTrue([unit scheduleTransitionToInput:1 primeFrame:4 fadeFrame:7 fadeFrames:1]);
    list.buffers[0].mDataByteSize = sizeof(samples);
    stamp.mSampleTime = 4;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(samples[frame], frame < 3 ? frame + 4 : frame + 100); }
    XCTAssertEqual(unit.activeInput, 1);
    XCTAssertFalse(unit.transitionPending);
    XCTAssertEqual(consumed[0], 8);
    XCTAssertEqual(consumed[1], 8);
    XCTAssertTrue([unit scheduleTransitionToInput:0 primeFrame:12 fadeFrame:14 fadeFrames:3]);
    list.buffers[0].mDataByteSize = sizeof(samples);
    stamp.mSampleTime = 12;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    const float expected[] = {108, 109, 110, 61, 12, 13, 14, 15};
    for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(samples[frame], expected[frame]); }
    XCTAssertEqual(unit.activeInput, 0);
    XCTAssertFalse(unit.transitionPending);
    XCTAssertEqual(consumed[0], 16);
    XCTAssertEqual(consumed[1], 13);
    [unit reset];
    XCTAssertEqual(unit.renderedFrameCount, 0);
    XCTAssertEqual(unit.activeInput, 0);
    XCTAssertFalse(unit.transitionPending);
    XCTAssertEqual(unit.renderFailureCount, 0);
    XCTAssertTrue([unit scheduleTransitionToInput:1 primeFrame:0 fadeFrame:0 fadeFrames:1]);
    [unit deallocateRenderResources];
    XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:0 fadeFrame:0 fadeFrames:1]);
}

- (void)testSchedulingDuringRenderReservesTheEntireCurrentBlock {
    auto *unit = [self unitWithChannels:1 sampleRate:48000 maximumFrames:16];
    if (!unit) { return; }
    __block bool scheduled = false;
    auto pull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount count, NSInteger bus, AudioBufferList *buffers) {
        if (!scheduled) {
            XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:0 fadeFrame:16 fadeFrames:4]);
            XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:15 fadeFrame:16 fadeFrames:4]);
            XCTAssertTrue([unit scheduleTransitionToInput:1 primeFrame:16 fadeFrame:16 fadeFrames:4]);
            scheduled = true;
        }
        std::fill_n(static_cast<float *>(buffers->mBuffers[0].mData), count, bus == 0 ? 1 : -1);
        return noErr;
    };
    auto render = unit.internalRenderBlock;
    float samples[16] = {};
    PodcstHandoffTestList list = {1, {{1, sizeof(samples), samples}, {}}};
    AudioTimeStamp stamp = {};
    stamp.mFlags = kAudioTimeStampSampleTimeValid;
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 16, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    for (float sample : samples) { XCTAssertEqual(sample, 1); }
    XCTAssertTrue(unit.transitionPending);
    XCTAssertEqual(render(&flags, &stamp, 16, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    XCTAssertEqual(samples[0], 1);
    XCTAssertEqualWithAccuracy(samples[1], 1.0f / 3, 1e-7);
    XCTAssertEqualWithAccuracy(samples[2], -1.0f / 3, 1e-7);
    for (uint32_t frame = 3; frame < 16; ++frame) { XCTAssertEqual(samples[frame], -1); }
    XCTAssertFalse(unit.transitionPending);
    XCTAssertEqual(unit.activeInput, 1);
    [unit deallocateRenderResources];
}

- (void)testSilenceFlagsIgnoreUnusedPrimingAudioAndHandleNullSilentBuffers {
    auto *unit = [self unitWithChannels:2 sampleRate:48000 maximumFrames:8];
    if (!unit) { return; }
    XCTAssertTrue([unit scheduleTransitionToInput:1 primeFrame:0 fadeFrame:8 fadeFrames:1]);
    auto pull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *flags, const AudioTimeStamp *, AUAudioFrameCount count, NSInteger bus, AudioBufferList *buffers) {
        if (bus == 0) {
            *flags |= kAudioUnitRenderAction_OutputIsSilence;
            for (uint32_t channel = 0; channel < 2; ++channel) { buffers->mBuffers[channel].mData = nullptr; buffers->mBuffers[channel].mDataByteSize = 0; }
        } else {
            for (uint32_t channel = 0; channel < 2; ++channel) { std::fill_n(static_cast<float *>(buffers->mBuffers[channel].mData), count, 0.25f); }
        }
        return noErr;
    };
    auto render = unit.internalRenderBlock;
    PodcstHandoffTestList list = {2, {{1, 0, nullptr}, {1, 0, nullptr}}};
    AudioTimeStamp stamp = {};
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    XCTAssertNotEqual(flags & kAudioUnitRenderAction_OutputIsSilence, 0);
    for (uint32_t channel = 0; channel < 2; ++channel) {
        for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(static_cast<float *>(list.buffers[channel].mData)[frame], 0); }
    }
    XCTAssertEqual(render(&flags, &stamp, 8, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
    XCTAssertEqual(flags & kAudioUnitRenderAction_OutputIsSilence, 0);
    for (uint32_t channel = 0; channel < 2; ++channel) {
        for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(static_cast<float *>(list.buffers[channel].mData)[frame], 0.25f); }
    }
    XCTAssertEqual(unit.activeInput, 1);
    [unit deallocateRenderResources];
}

- (void)testInvalidCommandsLayoutsAndPullFailures {
    auto *unit = [self unitWithChannels:2 sampleRate:48000 maximumFrames:16];
    if (!unit) { return; }
    XCTAssertFalse([unit scheduleTransitionToInput:0 primeFrame:0 fadeFrame:0 fadeFrames:4]);
    XCTAssertFalse([unit scheduleTransitionToInput:2 primeFrame:0 fadeFrame:0 fadeFrames:4]);
    XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:0 fadeFrame:0 fadeFrames:0]);
    XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:4 fadeFrame:3 fadeFrames:1]);
    XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:0 fadeFrame:UINT64_MAX fadeFrames:1]);
    XCTAssertTrue([unit scheduleTransitionToInput:1 primeFrame:8 fadeFrame:10 fadeFrames:4]);
    XCTAssertFalse([unit scheduleTransitionToInput:1 primeFrame:8 fadeFrame:10 fadeFrames:4]);
    auto render = unit.internalRenderBlock;
    float samples[32];
    std::fill_n(samples, 32, 42);
    PodcstHandoffTestList list = {2, {{1, 64, samples}, {1, 64, samples + 16}}};
    auto *buffers = reinterpret_cast<AudioBufferList *>(&list);
    AudioTimeStamp stamp = {};
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 17, 0, buffers, nullptr, nil), kAudioUnitErr_TooManyFramesToProcess);
    XCTAssertEqual(render(&flags, &stamp, 8, 1, buffers, nullptr, nil), kAudio_ParamError);
    list.count = 1;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudio_ParamError);
    list.count = 2;
    list.buffers[0].mDataByteSize = 1;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudio_ParamError);
    list.buffers[0].mDataByteSize = 64;
    for (float sample : samples) { XCTAssertEqual(sample, 42); }
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudioUnitErr_NoConnection);
    auto invalid = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount, NSInteger, AudioBufferList *input) {
        input->mBuffers[1].mNumberChannels = 2;
        return noErr;
    };
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, invalid), kAudio_ParamError);
    auto failed = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount, NSInteger, AudioBufferList *) { return kAudioUnitErr_CannotDoInCurrentContext; };
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, failed), kAudioUnitErr_CannotDoInCurrentContext);
    XCTAssertEqual(unit.renderedFrameCount, 0);
    XCTAssertEqual(unit.activeInput, 0);
    XCTAssertTrue(unit.transitionPending);
    XCTAssertEqual(unit.renderFailureCount, 7);
    for (uint32_t channel = 0; channel < 2; ++channel) {
        for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(static_cast<float *>(list.buffers[channel].mData)[frame], 0); }
    }
    [unit reset];
    XCTAssertEqual(unit.renderFailureCount, 0);
    XCTAssertFalse(unit.transitionPending);
    [unit deallocateRenderResources];
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudioUnitErr_Uninitialized);
}

- (void)testPCMSourcePreservesExactSamplesAcrossRingWrapAndShortRenders {
    for (uint32_t channels : {1, 2}) {
        for (uint32_t rate : {8000, 44100, 48000, 192000}) {
            NSError *error = nil;
            auto *unit = [[PodcstPCMSourceAudioUnit alloc] initWithComponentDescription:[PodcstPCMSourceAudioUnit componentDescription] options:0 error:&error];
            AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:rate channels:channels];
            XCTAssertTrue([unit configureCapacityFrames:17 error:&error]);
            XCTAssertTrue([unit.outputBusses[0] setFormat:format error:&error]);
            unit.maximumFramesToRender = 7;
            XCTAssertTrue([unit allocateRenderResourcesAndReturnError:&error]);
            XCTAssertNil(error);
            if (!unit || error) { return; }
            XCTAssertEqual(unit.inputBusses.count, 0);
            XCTAssertEqual(unit.freeFrames, 17);
            const uint64_t bytes = unit.allocatedBytes;
            XCTAssertLessThan(bytes, 4096);
            auto *input = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:17];
            auto render = unit.internalRenderBlock;
            uint64_t issued = 0;
            uint64_t consumed = 0;
            uint64_t rendered = 0;
            uint64_t underruns = 0;
            uint32_t rejected = 0;
            const uint32_t lengths[] = {14, 3, 9, 1};
            for (uint32_t iteration = 0; iteration < 500 && consumed < 200; ++iteration) {
                if (iteration > 0 && issued < 200) {
                    const uint32_t count = static_cast<uint32_t>(std::min<uint64_t>(lengths[iteration % 4], 200 - issued));
                    input.frameLength = count;
                    for (uint32_t channel = 0; channel < channels; ++channel) {
                        for (uint32_t frame = 0; frame < count; ++frame) {
                            input.floatChannelData[channel][frame] = static_cast<float>(static_cast<int>((issued + frame) * 7 % 37) - 18) / 16 * (channel + 1);
                        }
                    }
                    const uint32_t available = unit.availableFrames;
                    if (count <= unit.freeFrames) {
                        XCTAssertTrue([unit enqueueBuffer:input]);
                        issued += count;
                    } else {
                        XCTAssertFalse([unit enqueueBuffer:input]);
                        XCTAssertEqual(unit.availableFrames, available);
                        ++rejected;
                    }
                    XCTAssertEqual(unit.enqueuedFrameCount, issued);
                }
                const uint32_t frames = iteration * 3 % 7 + 1;
                const uint32_t content = static_cast<uint32_t>(std::min<uint64_t>(frames, issued - consumed));
                float samples[14];
                PodcstHandoffTestList list = {channels, {{1, 28, samples}, {1, 28, samples + 7}}};
                if (iteration % 3 == 0) { list.buffers[0].mData = nullptr; list.buffers[1].mData = nullptr; }
                AudioTimeStamp stamp = {};
                stamp.mSampleTime = rendered + 987654;
                stamp.mFlags = kAudioTimeStampSampleTimeValid;
                AudioUnitRenderActionFlags flags = 0;
                XCTAssertEqual(render(&flags, &stamp, frames, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, nil), noErr);
                bool silent = true;
                for (uint32_t channel = 0; channel < channels; ++channel) {
                    const auto *output = static_cast<float *>(list.buffers[channel].mData);
                    for (uint32_t frame = 0; frame < frames; ++frame) {
                        const float expected = frame < content ? static_cast<float>(static_cast<int>((consumed + frame) * 7 % 37) - 18) / 16 * (channel + 1) : 0;
                        XCTAssertEqual(output[frame], expected);
                        silent = silent && expected == 0;
                    }
                }
                consumed += content;
                rendered += frames;
                underruns += frames - content;
                XCTAssertEqual((flags & kAudioUnitRenderAction_OutputIsSilence) != 0, silent);
                XCTAssertEqual(unit.consumedFrameCount, consumed);
                XCTAssertEqual(unit.renderedFrameCount, rendered);
                XCTAssertEqual(unit.underrunFrameCount, underruns);
                XCTAssertEqual(unit.availableFrames, issued - consumed);
                XCTAssertEqual(unit.freeFrames + unit.availableFrames, 17);
                XCTAssertEqual(unit.allocatedBytes, bytes);
            }
            XCTAssertEqual(issued, 200);
            XCTAssertEqual(consumed, 200);
            XCTAssertGreaterThan(rejected, 0);
            XCTAssertEqual(unit.renderFailureCount, 0);
            input.frameLength = 7;
            XCTAssertTrue([unit enqueueBuffer:input]);
            [unit reset];
            XCTAssertEqual(unit.enqueuedFrameCount, 0);
            XCTAssertEqual(unit.consumedFrameCount, 0);
            XCTAssertEqual(unit.renderedFrameCount, 0);
            XCTAssertEqual(unit.underrunFrameCount, 0);
            XCTAssertEqual(unit.freeFrames, 17);
            PodcstHandoffTestList empty = {channels, {{1, 0, nullptr}, {1, 0, nullptr}}};
            AudioTimeStamp stamp = {};
            AudioUnitRenderActionFlags flags = 0;
            XCTAssertEqual(render(&flags, &stamp, 7, 0, reinterpret_cast<AudioBufferList *>(&empty), nullptr, nil), noErr);
            XCTAssertNotEqual(flags & kAudioUnitRenderAction_OutputIsSilence, 0);
            XCTAssertEqual(unit.consumedFrameCount, 0);
            XCTAssertEqual(unit.underrunFrameCount, 7);
            for (uint32_t channel = 0; channel < channels; ++channel) {
                for (uint32_t frame = 0; frame < 7; ++frame) { XCTAssertEqual(static_cast<float *>(empty.buffers[channel].mData)[frame], 0); }
            }
            [unit deallocateRenderResources];
            XCTAssertFalse([unit enqueueBuffer:input]);
        }
    }
}

- (void)testPCMSourceRejectsInvalidConfigurationAndPreservesQueueOnRenderErrors {
    NSError *error = nil;
    auto *unit = [[PodcstPCMSourceAudioUnit alloc] initWithComponentDescription:[PodcstPCMSourceAudioUnit componentDescription] options:0 error:&error];
    XCTAssertFalse([unit configureCapacityFrames:0 error:&error]);
    XCTAssertFalse([unit configureCapacityFrames:1048577 error:&error]);
    error = nil;
    XCTAssertTrue([unit configureCapacityFrames:11 error:&error]);
    AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:48000 channels:1];
    XCTAssertTrue([unit.outputBusses[0] setFormat:format error:&error]);
    unit.maximumFramesToRender = 8;
    XCTAssertTrue([unit allocateRenderResourcesAndReturnError:&error]);
    XCTAssertNil(error);
    if (!unit || error) { return; }
    XCTAssertFalse([unit configureCapacityFrames:17 error:&error]);
    XCTAssertEqual(error.code, kAudioUnitErr_Initialized);
    AVAudioFormat *wrongFormat = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100 channels:1];
    auto *wrong = [[AVAudioPCMBuffer alloc] initWithPCMFormat:wrongFormat frameCapacity:8];
    wrong.frameLength = 8;
    XCTAssertFalse([unit enqueueBuffer:wrong]);
    auto *input = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:12];
    input.frameLength = 12;
    XCTAssertFalse([unit enqueueBuffer:input]);
    input.frameLength = 8;
    std::fill_n(input.floatChannelData[0], 8, 0.25f);
    XCTAssertTrue([unit enqueueBuffer:input]);
    auto render = unit.internalRenderBlock;
    float samples[8];
    std::fill_n(samples, 8, 42);
    PodcstHandoffTestList list = {1, {{1, 32, samples}, {}}};
    auto *buffers = reinterpret_cast<AudioBufferList *>(&list);
    AudioTimeStamp stamp = {};
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 9, 0, buffers, nullptr, nil), kAudioUnitErr_TooManyFramesToProcess);
    XCTAssertEqual(render(&flags, &stamp, 8, 1, buffers, nullptr, nil), kAudio_ParamError);
    list.buffers[0].mDataByteSize = 1;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudio_ParamError);
    list.buffers[0].mDataByteSize = 32;
    XCTAssertEqual(unit.renderFailureCount, 3);
    XCTAssertEqual(unit.consumedFrameCount, 0);
    XCTAssertEqual(unit.enqueuedFrameCount, 8);
    XCTAssertEqual(unit.availableFrames, 8);
    XCTAssertEqual(unit.underrunFrameCount, 0);
    for (float sample : samples) { XCTAssertEqual(sample, 42); }
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), noErr);
    for (float sample : samples) { XCTAssertEqual(sample, 0.25f); }
    XCTAssertEqual(unit.consumedFrameCount, 8);
    [unit reset];
    XCTAssertEqual(unit.renderFailureCount, 0);
    [unit deallocateRenderResources];
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudioUnitErr_Uninitialized);
}

- (void)testPCMSourceConcurrentProducerAndRendererPreserveStereoOrder {
    NSError *error = nil;
    auto *unit = [[PodcstPCMSourceAudioUnit alloc] initWithComponentDescription:[PodcstPCMSourceAudioUnit componentDescription] options:0 error:&error];
    AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100 channels:2];
    XCTAssertTrue([unit configureCapacityFrames:31 error:&error]);
    XCTAssertTrue([unit.outputBusses[0] setFormat:format error:&error]);
    unit.maximumFramesToRender = 13;
    XCTAssertTrue([unit allocateRenderResourcesAndReturnError:&error]);
    XCTAssertNil(error);
    if (!unit || error) { return; }
    auto *input = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:17];
    auto render = unit.internalRenderBlock;
    constexpr uint64_t total = 100000;
    std::atomic<bool> valid{true};
    uint64_t delivered = 0;
    std::thread consumer([&] {
        @autoreleasepool {
            uint64_t next = 0;
            uint64_t iteration = 0;
            float samples[26];
            AudioTimeStamp stamp = {};
            AudioUnitRenderActionFlags flags = 0;
            while (next < total && valid.load() && iteration < 5000000) {
                const uint32_t frames = iteration++ % 13 + 1;
                PodcstHandoffTestList list = {2, {{1, 52, samples}, {1, 52, samples + 13}}};
                if (render(&flags, &stamp, frames, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, nil) != noErr) { valid.store(false); break; }
                for (uint32_t frame = 0; frame < frames; ++frame) {
                    if (samples[frame] != 0) {
                        if (samples[frame] != static_cast<float>(next % 65519 + 1) || samples[13 + frame] != -samples[frame]) { valid.store(false); break; }
                        ++next;
                    } else if (samples[13 + frame] != 0) { valid.store(false); break; }
                }
                stamp.mSampleTime += frames;
                std::this_thread::yield();
            }
            if (next != total) { valid.store(false); }
            delivered = next;
        }
    });
    uint64_t written = 0;
    while (written < total && valid.load()) {
        const uint32_t frames = static_cast<uint32_t>(std::min<uint64_t>(written % 17 + 1, total - written));
        if (unit.freeFrames < frames) { std::this_thread::yield(); continue; }
        input.frameLength = frames;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            input.floatChannelData[0][frame] = static_cast<float>((written + frame) % 65519 + 1);
            input.floatChannelData[1][frame] = -input.floatChannelData[0][frame];
        }
        if (![unit enqueueBuffer:input]) { valid.store(false); break; }
        written += frames;
    }
    consumer.join();
    XCTAssertTrue(valid.load());
    XCTAssertEqual(written, total);
    XCTAssertEqual(delivered, total);
    XCTAssertEqual(unit.consumedFrameCount, total);
    XCTAssertEqual(unit.enqueuedFrameCount, total);
    XCTAssertEqual(unit.renderFailureCount, 0);
    [unit deallocateRenderResources];
}

@end
