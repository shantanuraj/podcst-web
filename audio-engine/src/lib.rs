pub mod analysis;
pub mod audio;
pub mod ffi;
pub mod fixtures;
pub mod processing;
pub mod speech;
pub mod vectors;
pub mod wav;

pub use analysis::{
    AdaptiveSilenceConfig, AnalysisConfig, AudioMetrics, SilenceConfig, SilenceFrameDecision,
    SilenceFrameSegment, SilenceSegment, StreamingLoudnessAnalyzer, StreamingLoudnessMetrics,
    StreamingSilenceConfig, StreamingSilenceDetector, analyze, detect_adaptive_silence,
    detect_silence, integrated_lufs, oversampled_peak, rms_dbfs, sample_peak,
};
pub use audio::{AudioError, PcmAudio};
pub use processing::{
    AudioFormat, BoostConfig, GainProcessor, LimiterConfig, LookaheadLimiter, PcmProcessor,
    ProcessReport, ProcessedAudio, ProcessingConfig, StreamingProcessor, TimelineMap,
    TimelineSegment, TrimConfig, TrimEditConfig, TruePeakLimiter, process_audio, process_streaming,
};
pub use wav::{read_wav, write_wav};
