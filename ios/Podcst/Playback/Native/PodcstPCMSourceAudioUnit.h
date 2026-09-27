#import <AudioToolbox/AudioToolbox.h>

@class AVAudioPCMBuffer;

NS_ASSUME_NONNULL_BEGIN

@interface PodcstPCMSourceAudioUnit : AUAudioUnit

+ (AudioComponentDescription)componentDescription;
+ (void)registerAudioUnit;

@property(nonatomic, readonly) uint32_t capacityFrames;
@property(nonatomic, readonly) uint32_t availableFrames;
@property(nonatomic, readonly) uint32_t freeFrames;
@property(nonatomic, readonly) uint64_t consumedFrameCount;
@property(nonatomic, readonly) uint64_t enqueuedFrameCount;
@property(nonatomic, readonly) uint64_t renderedFrameCount;
@property(nonatomic, readonly) uint64_t underrunFrameCount;
@property(nonatomic, readonly) uint64_t allocatedBytes;
@property(nonatomic, readonly) uint64_t renderFailureCount;

- (BOOL)configureCapacityFrames:(uint32_t)frames error:(NSError * _Nullable * _Nullable)error;
- (BOOL)enqueueBuffer:(AVAudioPCMBuffer *)buffer NS_SWIFT_NAME(enqueueBuffer(_:));

@end

NS_ASSUME_NONNULL_END
