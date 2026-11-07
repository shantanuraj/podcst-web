#import <AudioToolbox/AudioToolbox.h>

NS_ASSUME_NONNULL_BEGIN

typedef struct PodcstOutputTelemetryInfo {
    uint64_t outputStartFrame;
    uint32_t frameCount;
    uint32_t channels;
    double sampleRate;
    float limiterReductionDB;
} PodcstOutputTelemetryInfo;

typedef struct PodcstRenderDiagnostics {
    uint64_t callbacks;
    uint64_t frames;
    uint64_t silentFrames;
    uint64_t failedFrames;
    uint64_t callbackGapCandidates;
    uint64_t sampleTimeDiscontinuities;
    double maximumCallbackInterval;
    double maximumCallbackOverrun;
    double maximumSampleTimeDiscontinuity;
} PodcstRenderDiagnostics;

@interface PodcstLimiterAudioUnit : AUAudioUnit

+ (AudioComponentDescription)componentDescription;
+ (void)registerAudioUnit;

@property(nonatomic, readonly) BOOL limiterEnabled;
@property(nonatomic, readonly) AUAudioFrameCount latencyFrames;
@property(nonatomic, readonly) uint64_t renderedFrameCount;
@property(nonatomic, readonly) uint64_t inputFrameCount;
@property(nonatomic, readonly) uint64_t emittedFrameCount;
@property(nonatomic, readonly) uint64_t firstRenderHostTime;
@property(nonatomic, readonly) uint64_t firstRenderHostFrameOffset;
@property(nonatomic, readonly) uint64_t allocatedBytes;
@property(nonatomic, readonly) uint64_t renderFailureCount;
@property(nonatomic, readonly) OSStatus lastRenderStatus;
@property(nonatomic, readonly) BOOL isDrained;
@property(nonatomic) BOOL telemetryEnabled;
@property(nonatomic, readonly) uint64_t droppedTelemetryFrames;
@property(nonatomic) BOOL performanceDiagnosticsEnabled;
@property(nonatomic, readonly) PodcstRenderDiagnostics renderDiagnostics;

- (uint32_t)copyTelemetryFrames:(float *)samples capacity:(uint32_t)capacity throughOutputFrame:(uint64_t)throughOutputFrame info:(PodcstOutputTelemetryInfo *)info NS_SWIFT_NAME(copyTelemetryFrames(_:capacity:throughOutputFrame:info:));

- (BOOL)configureLimiterEnabled:(BOOL)enabled error:(NSError * _Nullable * _Nullable)error;
- (void)beginDraining;

@end

NS_ASSUME_NONNULL_END
