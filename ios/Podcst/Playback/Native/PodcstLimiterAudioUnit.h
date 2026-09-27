#import <AudioToolbox/AudioToolbox.h>

NS_ASSUME_NONNULL_BEGIN

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

- (BOOL)configureLimiterEnabled:(BOOL)enabled error:(NSError * _Nullable * _Nullable)error;
- (void)beginDraining;

@end

NS_ASSUME_NONNULL_END
