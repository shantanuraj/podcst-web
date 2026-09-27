#import <XCTest/XCTest.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AUAudioUnitImplementation.h>
#import "PodcstLimiterAudioUnit.h"
#import "podcst_audio.h"

#include <algorithm>
#include <vector>

struct PodcstTestPlanarList {
    UInt32 count;
    AudioBuffer buffers[2];
};

@interface NativeRenderTests : XCTestCase
@end

@implementation NativeRenderTests

- (void)setUp {
    [super setUp];
    [PodcstLimiterAudioUnit registerAudioUnit];
}

- (void)testFinalLimiterMatchesRustAcrossLayoutsCapacitiesAndLifecycle {
    for (uint32_t channels : {1, 2}) {
        for (uint32_t rate : {44100, 48000}) {
            for (uint32_t frames : {0, 9, 4099}) {
                for (bool enabled : {false, true}) {
                    [self checkChannels:channels sampleRate:rate sourceFrames:frames enabled:enabled];
                }
            }
        }
    }
}

- (void)checkChannels:(uint32_t)channels sampleRate:(uint32_t)sampleRate sourceFrames:(uint32_t)sourceFrames enabled:(BOOL)enabled {
    NSError *error = nil;
    auto *unit = [[PodcstLimiterAudioUnit alloc] initWithComponentDescription:[PodcstLimiterAudioUnit componentDescription] options:0 error:&error];
    XCTAssertNotNil(unit);
    XCTAssertNil(error);
    if (!unit) { return; }
    XCTAssertTrue([unit configureLimiterEnabled:enabled error:&error]);
    AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:sampleRate channels:channels];
    XCTAssertTrue([unit.inputBusses[0] setFormat:format error:&error]);
    XCTAssertTrue([unit.outputBusses[0] setFormat:format error:&error]);
    unit.maximumFramesToRender = 257;
    XCTAssertTrue([unit allocateRenderResourcesAndReturnError:&error]);
    XCTAssertNil(error);
    if (error) { return; }
    XCTAssertFalse([unit configureLimiterEnabled:!enabled error:&error]);
    XCTAssertEqual(error.code, kAudioUnitErr_Initialized);
    auto render = unit.internalRenderBlock;
    std::vector<float> input(sourceFrames * channels);
    for (size_t i = 0; i < input.size(); ++i) { input[i] = float((i * 97) % 997) / 250 - 2; }
    PodcstAudioConfig config;
    XCTAssertEqual(podcst_audio_config_default(&config), PODCST_AUDIO_OK);
    config.channels = channels;
    config.sample_rate = sampleRate;
    config.limiter_enabled = enabled;
    PodcstAudioProcessor *reference = nullptr;
    XCTAssertEqual(podcst_audio_create(&config, &reference), PODCST_AUDIO_OK);
    if (!reference) { return; }
    std::vector<float> expected(input.size() + 2048);
    PodcstAudioReport report;
    XCTAssertEqual(podcst_audio_process(reference, input.data(), sourceFrames, expected.data(), sourceFrames, &report), PODCST_AUDIO_OK);
    size_t expectedFrames = report.emitted_frames;
    XCTAssertEqual(podcst_audio_finish(reference, expected.data() + expectedFrames * channels, 1024, &report), PODCST_AUDIO_FINISHED);
    expectedFrames += report.emitted_frames;
    XCTAssertEqual(expectedFrames, sourceFrames);
    expected.resize(expectedFrames * channels);
    const uint32_t latency = sourceFrames > 0 ? unit.latencyFrames : 0;
    XCTAssertEqual(unit.latencyFrames == 0, !enabled);
    XCTAssertLessThan(unit.allocatedBytes, 1024 * 1024);
    std::vector<float> actual;
    float output[514];
    AudioTimeStamp stamp = {};
    stamp.mFlags = kAudioTimeStampSampleTimeValid;
    uint32_t cursor = 0;
    bool requestedDrain = false;
    uint32_t calls = 0;
    while ((!requestedDrain || !unit.isDrained) && calls++ < 10000) {
        uint32_t frames = (cursor * 43 % 257) + 1;
        if (cursor < sourceFrames) { frames = std::min(frames, sourceFrames - cursor); }
        else { [unit beginDraining]; requestedDrain = true; }
        PodcstTestPlanarList list = {channels, {{1, frames * 4, output}, {1, frames * 4, output + 257}}};
        if (cursor % 3 == 0) { list.buffers[0].mData = nullptr; list.buffers[1].mData = nullptr; }
        const float *source = input.empty() ? nullptr : input.data() + cursor * channels;
        auto pull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount count, NSInteger, AudioBufferList *buffers) {
            if (requestedDrain) { return kAudioUnitErr_NoConnection; }
            for (uint32_t c = 0; c < channels; ++c) {
                for (uint32_t frame = 0; frame < count; ++frame) { static_cast<float *>(buffers->mBuffers[c].mData)[frame] = source[frame * channels + c]; }
            }
            return noErr;
        };
        AudioUnitRenderActionFlags flags = 0;
        XCTAssertEqual(render(&flags, &stamp, frames, 0, reinterpret_cast<AudioBufferList *>(&list), nullptr, pull), noErr);
        for (uint32_t frame = 0; frame < frames; ++frame) {
            for (uint32_t c = 0; c < channels; ++c) { actual.push_back(static_cast<float *>(list.buffers[c].mData)[frame]); }
        }
        if (!requestedDrain) { cursor += frames; }
        stamp.mSampleTime += frames;
    }
    XCTAssertLessThan(calls, 10000);
    XCTAssertEqual(unit.inputFrameCount, sourceFrames);
    XCTAssertEqual(unit.emittedFrameCount, sourceFrames);
    XCTAssertEqual(unit.renderedFrameCount, actual.size() / channels);
    XCTAssertGreaterThanOrEqual(actual.size(), (latency + sourceFrames) * channels);
    if (actual.size() >= (latency + sourceFrames) * channels) {
        for (uint32_t i = 0; i < latency * channels; ++i) { XCTAssertEqual(actual[i], 0); }
        for (uint32_t i = 0; i < sourceFrames * channels; ++i) { XCTAssertEqual(actual[latency * channels + i], expected[i]); }
        for (size_t i = (latency + sourceFrames) * channels; i < actual.size(); ++i) { XCTAssertEqual(actual[i], 0); }
    }
    [unit reset];
    XCTAssertEqual(unit.inputFrameCount, 0);
    XCTAssertEqual(unit.renderedFrameCount, 0);
    XCTAssertEqual(unit.emittedFrameCount, 0);
    XCTAssertFalse(unit.isDrained);
    [unit beginDraining];
    PodcstTestPlanarList empty = {channels, {{1, 32, output}, {1, 32, output + 257}}};
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, reinterpret_cast<AudioBufferList *>(&empty), nullptr, nil), noErr);
    XCTAssertTrue(unit.isDrained);
    XCTAssertEqual(unit.emittedFrameCount, 0);
    for (uint32_t c = 0; c < channels; ++c) {
        for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(static_cast<float *>(empty.buffers[c].mData)[frame], 0); }
    }
    [unit deallocateRenderResources];
    XCTAssertEqual(render(&flags, &stamp, 8, 0, reinterpret_cast<AudioBufferList *>(&empty), nullptr, nil), kAudioUnitErr_Uninitialized);
    XCTAssertEqual(podcst_audio_destroy(&reference), PODCST_AUDIO_OK);
}

- (void)testInvalidRenderLayoutsAndUpstreamFailuresPreserveDSPState {
    NSError *error = nil;
    auto *unit = [[PodcstLimiterAudioUnit alloc] initWithComponentDescription:[PodcstLimiterAudioUnit componentDescription] options:0 error:&error];
    XCTAssertNotNil(unit);
    if (!unit) { return; }
    AVAudioFormat *interleaved = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:48000 channels:2 interleaved:YES];
    XCTAssertFalse([unit.inputBusses[0] setFormat:interleaved error:&error]);
    unit.maximumFramesToRender = 16;
    error = nil;
    XCTAssertTrue([unit allocateRenderResourcesAndReturnError:&error]);
    XCTAssertNil(error);
    if (error) { return; }
    auto render = unit.internalRenderBlock;
    float output[32];
    std::fill(std::begin(output), std::end(output), 42);
    PodcstTestPlanarList list = {2, {{1, 64, output}, {1, 64, output + 16}}};
    auto *buffers = reinterpret_cast<AudioBufferList *>(&list);
    AudioTimeStamp stamp = {};
    stamp.mFlags = kAudioTimeStampSampleTimeValid;
    AudioUnitRenderActionFlags flags = 0;
    XCTAssertEqual(render(&flags, &stamp, 17, 0, buffers, nullptr, nil), kAudioUnitErr_TooManyFramesToProcess);
    XCTAssertEqual(unit.inputFrameCount, 0);
    XCTAssertEqual(unit.renderedFrameCount, 0);
    for (float sample : output) { XCTAssertEqual(sample, 42); }
    list.count = 1;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudio_ParamError);
    list.count = 2;
    list.buffers[0].mDataByteSize = 1;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), kAudio_ParamError);
    list.buffers[0].mDataByteSize = 64;
    auto invalidPull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount, NSInteger, AudioBufferList *input) {
        input->mBuffers[0].mDataByteSize = 1;
        return noErr;
    };
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, invalidPull), kAudio_ParamError);
    auto failedPull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount, NSInteger, AudioBufferList *) {
        return kAudioUnitErr_CannotDoInCurrentContext;
    };
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, failedPull), kAudioUnitErr_CannotDoInCurrentContext);
    XCTAssertEqual(unit.inputFrameCount, 0);
    XCTAssertEqual(unit.renderedFrameCount, 0);
    XCTAssertEqual(unit.renderFailureCount, 5);
    XCTAssertEqual(unit.lastRenderStatus, kAudioUnitErr_CannotDoInCurrentContext);
    XCTAssertFalse(unit.isDrained);
    auto goodPull = ^AUAudioUnitStatus(AudioUnitRenderActionFlags *, const AudioTimeStamp *, AUAudioFrameCount count, NSInteger, AudioBufferList *input) {
        for (uint32_t channel = 0; channel < 2; ++channel) {
            std::fill_n(static_cast<float *>(input->mBuffers[channel].mData), count, 0.1f);
        }
        return noErr;
    };
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, goodPull), noErr);
    XCTAssertEqual(unit.inputFrameCount, 8);
    XCTAssertEqual(unit.emittedFrameCount, 0);
    XCTAssertEqual(unit.firstRenderHostTime, 0);
    stamp.mFlags |= kAudioTimeStampHostTimeValid;
    stamp.mHostTime = 12345;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, goodPull), noErr);
    XCTAssertEqual(unit.firstRenderHostTime, 12345);
    XCTAssertEqual(unit.firstRenderHostFrameOffset, 8);
    stamp.mHostTime = 67890;
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, goodPull), noErr);
    XCTAssertEqual(unit.firstRenderHostTime, 12345);
    [unit reset];
    XCTAssertEqual(unit.inputFrameCount, 0);
    XCTAssertEqual(unit.renderFailureCount, 0);
    XCTAssertEqual(unit.lastRenderStatus, noErr);
    XCTAssertEqual(unit.firstRenderHostTime, 0);
    XCTAssertEqual(unit.firstRenderHostFrameOffset, 0);
    [unit beginDraining];
    XCTAssertEqual(render(&flags, &stamp, 8, 0, buffers, nullptr, nil), noErr);
    XCTAssertEqual(unit.emittedFrameCount, 0);
    XCTAssertTrue(unit.isDrained);
    for (uint32_t c = 0; c < 2; ++c) {
        for (uint32_t frame = 0; frame < 8; ++frame) { XCTAssertEqual(static_cast<float *>(buffers->mBuffers[c].mData)[frame], 0); }
    }
    [unit deallocateRenderResources];
}

@end
