#include "podcst_audio.h"
#include <assert.h>
#include <math.h>
#include <stddef.h>

_Static_assert(sizeof(PodcstAudioConfig) == 28, "config size");
_Static_assert(offsetof(PodcstAudioConfig, limiter_enabled) == 12, "config layout");
_Static_assert(sizeof(PodcstAudioReport) == 8, "report size");
_Static_assert(sizeof(PodcstAudioInfo) == 16, "info size");
_Static_assert(offsetof(PodcstAudioInfo, allocated_bytes) == 8, "info layout");

_Static_assert(sizeof(PodcstEffectsConfig) == 16, "effects config size");
_Static_assert(sizeof(PodcstEffectsReport) == 12, "effects report size");
_Static_assert(sizeof(PodcstSourceSpan) == 16, "source span size");
_Static_assert(sizeof(PodcstEffectsInfo) == 48, "effects info size");
_Static_assert(offsetof(PodcstEffectsInfo, applied_source_frame) == 40, "effects info layout");

static void verify_effects(void) {
    PodcstEffectsConfig config;
    assert(podcst_effects_config_default(&config) == PODCST_AUDIO_OK);
    PodcstEffectsProcessor *processor = NULL;
    assert(podcst_effects_create(&config, &processor) == PODCST_AUDIO_OK);
    assert(podcst_effects_reset(processor, 1000) == PODCST_AUDIO_OK);
    float input[] = {0.1f, -0.2f, 0.3f, -0.4f};
    float output[4] = {0};
    PodcstSourceSpan spans[2] = {0};
    PodcstEffectsReport report;
    assert(podcst_effects_process(processor, input, 2, output, 2, spans, 2, &report) == PODCST_AUDIO_OK);
    assert(report.consumed_frames == 2 && report.emitted_frames == 0);
    assert(podcst_effects_finish(processor, output, 1, spans, 2, &report) == PODCST_AUDIO_OUTPUT_FULL);
    assert(report.emitted_frames == 1 && report.span_count == 1);
    assert(output[0] == input[0] && output[1] == input[1]);
    assert(spans[0].source_start_frame == 1000 && spans[0].frame_count == 1);
    assert(podcst_effects_finish(processor, output, 1, spans, 2, &report) == PODCST_AUDIO_FINISHED);
    assert(output[0] == input[2] && output[1] == input[3]);
    assert(spans[0].source_start_frame == 1001);
    assert(podcst_effects_reset(processor, 2000) == PODCST_AUDIO_OK);
    assert(podcst_effects_configure(processor, 1, 1, 9) == PODCST_AUDIO_OK);
    assert(podcst_effects_process(processor, input, 1, output, 2, spans, 2, &report) == PODCST_AUDIO_OK);
    PodcstEffectsInfo info;
    assert(podcst_effects_get_info(processor, &info) == PODCST_AUDIO_OK);
    assert(info.applied_revision == 9 && info.applied_source_frame == 2000);
    assert(info.boost_enabled == 1 && info.trim_enabled == 1);
    assert(info.allocated_bytes < 4 * 1024 * 1024);
    assert(podcst_effects_destroy(&processor) == PODCST_AUDIO_OK && processor == NULL);
}

int main(void) {
    verify_effects();
    PodcstAudioConfig config;
    assert(podcst_audio_config_default(&config) == PODCST_AUDIO_OK);
    assert(config.channels == 2 && config.sample_rate == 48000);
    PodcstAudioProcessor *processor = NULL;
    assert(podcst_audio_create(&config, &processor) == PODCST_AUDIO_OK);
    const float input[] = {0.1f, -0.2f, 0.3f, -0.4f};
    float output[600] = {0};
    PodcstAudioReport report;
    assert(podcst_audio_process(processor, input, 2, output, 1, &report) == PODCST_AUDIO_OUTPUT_FULL);
    assert(report.consumed_frames == 1 && report.emitted_frames == 1);
    assert(output[0] == input[0] && output[1] == input[1]);
    assert(podcst_audio_process(processor, input + 2, 1, output, 1, &report) == PODCST_AUDIO_OK);
    assert(output[0] == input[2] && output[1] == input[3]);
    assert(podcst_audio_finish(processor, NULL, 0, &report) == PODCST_AUDIO_FINISHED);
    assert(podcst_audio_process(processor, input, 1, output, 1, &report) == PODCST_AUDIO_INVALID_STATE);
    assert(podcst_audio_destroy(&processor) == PODCST_AUDIO_OK && processor == NULL);
    assert(podcst_audio_destroy(&processor) == PODCST_AUDIO_OK);

    config.gain_db = 6.0f;
    config.limiter_enabled = 1;
    assert(podcst_audio_create(&config, &processor) == PODCST_AUDIO_OK);
    PodcstAudioInfo info;
    assert(podcst_audio_get_info(processor, &info) == PODCST_AUDIO_OK);
    assert(info.latency_frames == 255 && info.max_block_frames == PODCST_AUDIO_MAX_BLOCK_FRAMES);
    assert(info.allocated_bytes < 1048576);
    float loud[600];
    for (size_t index = 0; index < 600; ++index) loud[index] = index % 2 == 0 ? 1.5f : -1.5f;
    uint32_t consumed = 0;
    uint32_t emitted = 0;
    while (consumed < 300) {
        uint32_t status = podcst_audio_process(processor, loud + consumed * 2, 300 - consumed, output, 1, &report);
        assert(status == PODCST_AUDIO_OK || status == PODCST_AUDIO_OUTPUT_FULL);
        assert(report.consumed_frames > 0 && report.emitted_frames <= 1);
        consumed += report.consumed_frames;
        emitted += report.emitted_frames;
        for (uint32_t index = 0; index < report.emitted_frames * 2; ++index) {
            assert(isfinite(output[index]) && fabsf(output[index]) <= 0.9f);
        }
    }
    uint32_t status;
    do {
        status = podcst_audio_finish(processor, output, 1, &report);
        assert(status == PODCST_AUDIO_OUTPUT_FULL || status == PODCST_AUDIO_FINISHED);
        emitted += report.emitted_frames;
    } while (status != PODCST_AUDIO_FINISHED);
    assert(emitted == 300);
    assert(podcst_audio_finish(processor, output, 1, &report) == PODCST_AUDIO_FINISHED);
    assert(report.emitted_frames == 0);
    assert(podcst_audio_reset(processor) == PODCST_AUDIO_OK);
    assert(podcst_audio_finish(processor, output, 1, &report) == PODCST_AUDIO_FINISHED);
    assert(report.emitted_frames == 0);
    assert(podcst_audio_destroy(&processor) == PODCST_AUDIO_OK);
    return 0;
}
