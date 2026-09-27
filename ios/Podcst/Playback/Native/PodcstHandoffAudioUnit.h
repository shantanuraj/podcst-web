#import <AudioToolbox/AudioToolbox.h>

NS_ASSUME_NONNULL_BEGIN

@interface PodcstHandoffAudioUnit : AUAudioUnit

+ (AudioComponentDescription)componentDescription;
+ (void)registerAudioUnit;

@property(nonatomic, readonly) uint64_t renderedFrameCount;
@property(nonatomic, readonly) uint32_t activeInput;
@property(nonatomic, readonly) BOOL transitionPending;
@property(nonatomic, readonly) uint64_t allocatedBytes;
@property(nonatomic, readonly) uint64_t renderFailureCount;

- (BOOL)scheduleTransitionToInput:(uint32_t)input
                      primeFrame:(uint64_t)primeFrame
                       fadeFrame:(uint64_t)fadeFrame
                      fadeFrames:(uint32_t)fadeFrames
    NS_SWIFT_NAME(scheduleTransition(toInput:primeFrame:fadeFrame:fadeFrames:));

@end

NS_ASSUME_NONNULL_END
