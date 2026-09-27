#ifndef PODCST_AUDIO_H
#define PODCST_AUDIO_H

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#define PODCST_AUDIO_OK 0

#define PODCST_AUDIO_OUTPUT_FULL 1

#define PODCST_AUDIO_FINISHED 2

#define PODCST_AUDIO_INVALID_ARGUMENT 3

#define PODCST_AUDIO_INVALID_CONFIG 4

#define PODCST_AUDIO_INVALID_STATE 5

#define PODCST_AUDIO_INTERNAL_ERROR 6

#define PODCST_AUDIO_MAX_BLOCK_FRAMES 8192

typedef struct PodcstAudioProcessor PodcstAudioProcessor;

typedef struct PodcstAudioConfig {
  uint32_t sample_rate;
  uint32_t channels;
  float gain_db;
  uint32_t limiter_enabled;
  float lookahead_ms;
  float ceiling_dbfs;
  float release_ms;
} PodcstAudioConfig;

typedef struct PodcstAudioReport {
  uint32_t consumed_frames;
  uint32_t emitted_frames;
} PodcstAudioReport;

typedef struct PodcstAudioInfo {
  uint32_t latency_frames;
  uint32_t max_block_frames;
  uint64_t allocated_bytes;
} PodcstAudioInfo;

#ifdef __cplusplus
extern "C" {
#endif

uint32_t podcst_audio_config_default(struct PodcstAudioConfig *config);

uint32_t podcst_audio_create(const struct PodcstAudioConfig *config,
                             struct PodcstAudioProcessor **handle);

uint32_t podcst_audio_process(struct PodcstAudioProcessor *handle,
                              const float *input,
                              uint32_t input_frames,
                              float *output,
                              uint32_t output_capacity_frames,
                              struct PodcstAudioReport *report);

uint32_t podcst_audio_finish(struct PodcstAudioProcessor *handle,
                             float *output,
                             uint32_t output_capacity_frames,
                             struct PodcstAudioReport *report);

uint32_t podcst_audio_reset(struct PodcstAudioProcessor *handle);

uint32_t podcst_audio_get_info(struct PodcstAudioProcessor *handle, struct PodcstAudioInfo *info);

uint32_t podcst_audio_destroy(struct PodcstAudioProcessor **handle);

#ifdef __cplusplus
}
#endif

#endif
