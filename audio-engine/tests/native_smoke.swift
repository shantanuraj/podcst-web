import PodcstAudioEngine

func verifyProcessor(channels: UInt32, limiting: Bool) {
    var config = PodcstAudioConfig()
    precondition(podcst_audio_config_default(&config) == PODCST_AUDIO_OK)
    config.channels = channels
    config.limiter_enabled = limiting ? 1 : 0

    var handle: OpaquePointer?
    precondition(podcst_audio_create(&config, &handle) == PODCST_AUDIO_OK)
    precondition(handle != nil)

    var info = PodcstAudioInfo()
    precondition(podcst_audio_get_info(handle, &info) == PODCST_AUDIO_OK)
    precondition(info.max_block_frames == PODCST_AUDIO_MAX_BLOCK_FRAMES)
    precondition(info.allocated_bytes > 0)
    precondition(info.limiter_reduction_db == 0)
    precondition(limiting ? info.latency_frames > 0 : info.latency_frames == 0)

    let frameCount = 1_027
    let channelCount = Int(channels)
    let source = (0..<(frameCount * channelCount)).map { index in
        Float(index % 29 - 14) / 32
    }
    var scratch = [Float](repeating: 0, count: 17 * channelCount)
    var rendered: [Float] = []
    var consumed = 0

    while consumed < frameCount {
        let offered = min(123, frameCount - consumed)
        var report = PodcstAudioReport()
        let status = source.withUnsafeBufferPointer { input in
            scratch.withUnsafeMutableBufferPointer { output in
                podcst_audio_process(
                    handle, input.baseAddress!.advanced(by: consumed * channelCount),
                    UInt32(offered), output.baseAddress, 17, &report
                )
            }
        }
        precondition(status == PODCST_AUDIO_OK || status == PODCST_AUDIO_OUTPUT_FULL)
        precondition(report.consumed_frames <= offered && report.emitted_frames <= 17)
        precondition(report.consumed_frames > 0 || report.emitted_frames > 0)
        consumed += Int(report.consumed_frames)
        rendered.append(contentsOf: scratch.prefix(Int(report.emitted_frames) * channelCount))
    }

    while true {
        var report = PodcstAudioReport()
        let status = scratch.withUnsafeMutableBufferPointer { output in
            podcst_audio_finish(handle, output.baseAddress, 17, &report)
        }
        precondition(status == PODCST_AUDIO_FINISHED || status == PODCST_AUDIO_OUTPUT_FULL)
        precondition(report.consumed_frames == 0 && report.emitted_frames <= 17)
        rendered.append(contentsOf: scratch.prefix(Int(report.emitted_frames) * channelCount))
        if status == PODCST_AUDIO_FINISHED { break }
        precondition(report.emitted_frames > 0)
    }

    precondition(rendered.count == source.count)
    precondition(rendered.allSatisfy { $0.isFinite && abs($0) < 1 })
    if !limiting { precondition(rendered == source) }

    var report = PodcstAudioReport()
    precondition(podcst_audio_finish(handle, nil, 0, &report) == PODCST_AUDIO_FINISHED)
    precondition(report.emitted_frames == 0)
    precondition(podcst_audio_process(handle, nil, 0, nil, 0, &report) == PODCST_AUDIO_INVALID_STATE)
    precondition(podcst_audio_reset(handle) == PODCST_AUDIO_OK)
    precondition(podcst_audio_process(handle, nil, 0, nil, 0, &report) == PODCST_AUDIO_OK)
    precondition(podcst_audio_destroy(&handle) == PODCST_AUDIO_OK)
    precondition(handle == nil)
    precondition(podcst_audio_destroy(&handle) == PODCST_AUDIO_OK)
}

verifyProcessor(channels: 1, limiting: false)
verifyProcessor(channels: 2, limiting: true)
print("Swift native audio smoke passed")
