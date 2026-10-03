package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

sealed interface VectorStep {
    data class Process(
        val frames: Int,
        val capacity: Int,
        val spanCapacity: Int,
        val consumed: Int,
        val emitted: Int,
        val spanCount: Int,
    ) : VectorStep

    data class Finish(val capacity: Int, val spanCapacity: Int, val emitted: Int, val spanCount: Int, val finished: Boolean) :
        VectorStep

    data class Configure(val boost: Boolean, val trim: Boolean, val revision: Long) : VectorStep

    data class Reset(val origin: Long) : VectorStep
}

class VectorCase(
    val name: String,
    val effects: Boolean,
    val boost: Boolean,
    val trim: Boolean,
    val sampleRate: Int,
    val channels: Int,
    val pcm16: Boolean,
    val steps: List<VectorStep>,
    val spans: List<List<List<Long>>>,
    val input: ByteArray,
    val output: FloatArray,
) {
    val inputFrameBytes: Int get() = channels * if (pcm16) 2 else 4

    fun floatInput(): ByteBuffer {
        if (!pcm16) return direct(input.size).put(input).flip() as ByteBuffer
        val source = ByteBuffer.wrap(input).order(ByteOrder.LITTLE_ENDIAN)
        val floats = direct(input.size * 2)
        while (source.hasRemaining()) floats.putFloat(source.getShort() / 32_768f)
        return floats.flip() as ByteBuffer
    }

    fun rawInput(): ByteBuffer = direct(input.size).put(input).flip() as ByteBuffer

    override fun toString() = name
}

class Replayed(val output: FloatArray, val spans: List<List<List<Long>>>)

fun direct(bytes: Int): ByteBuffer = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())

fun loadVectors(read: (String) -> ByteArray): List<VectorCase> {
    check(ByteOrder.nativeOrder() == ByteOrder.LITTLE_ENDIAN)
    val manifest = Json.parseToJsonElement(read("manifest.json").decodeToString()).jsonObject
    return manifest.getValue("cases").jsonArray.map { element ->
        val case = element.jsonObject
        val name = case.text("name")
        val effects = case.text("engine") == "effects"
        val pcm16 = case.text("encoding") == "pcm16"
        val output = ByteBuffer.wrap(read("$name.output.f32")).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        VectorCase(
            name = name,
            effects = effects,
            boost = effects && case.flag("boost"),
            trim = effects && case.flag("trim"),
            sampleRate = case.number("sample_rate"),
            channels = case.number("channels"),
            pcm16 = pcm16,
            steps = case.getValue("steps").jsonArray.map { step(it.jsonObject, effects) },
            spans = case["spans"]?.jsonArray?.map { segment ->
                segment.jsonArray.map { span -> span.jsonArray.map { it.jsonPrimitive.long } }
            } ?: emptyList(),
            input = read("$name.input.${if (pcm16) "s16" else "f32"}"),
            output = FloatArray(output.remaining()).also { output.get(it) },
        )
    }
}

private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

private fun JsonObject.flag(key: String) = getValue(key).jsonPrimitive.boolean

private fun JsonObject.number(key: String) = getValue(key).jsonPrimitive.int

private fun step(step: JsonObject, effects: Boolean): VectorStep = when (step.text("op")) {
    "process" -> VectorStep.Process(
        frames = step.number("frames"),
        capacity = step.number("capacity"),
        spanCapacity = if (effects) step.number("span_capacity") else 0,
        consumed = step.number("consumed"),
        emitted = step.number("emitted"),
        spanCount = if (effects) step.number("span_count") else 0,
    )
    "finish" -> VectorStep.Finish(
        capacity = step.number("capacity"),
        spanCapacity = if (effects) step.number("span_capacity") else 0,
        emitted = step.number("emitted"),
        spanCount = if (effects) step.number("span_count") else 0,
        finished = step.flag("finished"),
    )
    "configure" -> VectorStep.Configure(step.flag("boost"), step.flag("trim"), step.getValue("revision").jsonPrimitive.long)
    "reset" -> VectorStep.Reset(step["origin"]?.jsonPrimitive?.long ?: 0)
    else -> error("unknown step $step")
}

class SpanCollector {
    private val segments = mutableListOf(mutableListOf<MutableList<Long>>())

    val spans: List<List<List<Long>>> get() = segments

    fun add(source: Long, output: Long, frames: Int) {
        val segment = segments.last()
        val last = segment.lastOrNull()
        if (last != null && last[0] + last[2] == source && last[1] + last[2] == output) {
            last[2] += frames.toLong()
        } else {
            segment += mutableListOf(source, output, frames.toLong())
        }
    }

    fun startSegment() {
        segments += mutableListOf<MutableList<Long>>()
    }
}

class OutputCollector(expected: Int) {
    private val samples = FloatArray(expected)
    private var size = 0

    fun add(buffer: ByteBuffer, from: Int, count: Int) {
        assertTrue("output overflows the expected ${samples.size} samples", size + count <= samples.size)
        for (index in 0 until count) samples[size + index] = buffer.getFloat(from + index * 4)
        size += count
    }

    fun result(): FloatArray = samples.copyOf(size)
}

fun replayWrapper(case: VectorCase): Replayed {
    val frameBytes = case.channels * 4
    val input = case.floatInput()
    val output = direct(MAX_BLOCK_FRAMES * frameBytes)
    val collector = OutputCollector(case.output.size)
    val spans = SpanCollector()
    val spanBuffers = HashMap<Int, SpanBuffer>()
    var position = 0
    var segmentFrames = 0L
    val effects = if (case.effects) EffectsProcessor(case.sampleRate, case.channels, case.boost, case.trim) else null
    val limiter = if (case.effects) null else Limiter(case.sampleRate, case.channels)
    fun collect(report: AudioReport, spanBuffer: SpanBuffer?) {
        assertEquals(report.emittedFrames * frameBytes, output.position())
        collector.add(output, 0, report.emittedFrames * case.channels)
        for (index in 0 until report.spanCount) {
            spans.add(
                spanBuffer!!.sourceStartFrame(index),
                segmentFrames + spanBuffer.outputStartFrame(index),
                spanBuffer.frameCount(index),
            )
        }
        segmentFrames += report.emittedFrames
    }
    try {
        for ((index, step) in case.steps.withIndex()) {
            val where = "${case.name} step $index $step"
            when (step) {
                is VectorStep.Process -> {
                    input.limit((position + step.frames) * frameBytes).position(position * frameBytes)
                    output.clear().limit(step.capacity * frameBytes)
                    val spanBuffer = spanBuffers.getOrPut(step.spanCapacity) { SpanBuffer(step.spanCapacity) }
                    val report = effects?.process(input, output, spanBuffer) ?: limiter!!.process(input, output)
                    assertEquals(where, step.consumed, report.consumedFrames)
                    assertEquals(where, step.emitted, report.emittedFrames)
                    assertEquals(where, step.spanCount, report.spanCount)
                    assertEquals(where, (position + step.consumed) * frameBytes, input.position())
                    if (step.consumed < step.frames) assertTrue(where, report.outputFull)
                    collect(report, spanBuffer)
                    position += step.consumed
                }
                is VectorStep.Finish -> {
                    output.clear().limit(step.capacity * frameBytes)
                    val spanBuffer = spanBuffers.getOrPut(step.spanCapacity) { SpanBuffer(step.spanCapacity) }
                    val report = effects?.finish(output, spanBuffer) ?: limiter!!.finish(output)
                    assertEquals(where, step.emitted, report.emittedFrames)
                    assertEquals(where, step.spanCount, report.spanCount)
                    assertEquals(where, step.finished, report.finished)
                    assertEquals(where, !step.finished, report.outputFull)
                    collect(report, spanBuffer)
                }
                is VectorStep.Configure -> effects!!.configure(step.boost, step.trim, step.revision)
                is VectorStep.Reset -> {
                    effects?.reset(step.origin) ?: limiter!!.reset()
                    spans.startSegment()
                    segmentFrames = 0
                }
            }
        }
    } finally {
        effects?.close()
        limiter?.close()
    }
    return Replayed(collector.result(), if (case.effects) spans.spans else emptyList())
}

fun replayMedia3(case: VectorCase, seed: Long): Replayed {
    val spans = SpanCollector()
    val effects = if (case.effects) RustEffectsAudioProcessor(spans::add) else null
    val processor: AudioProcessor = effects ?: RustLimiterAudioProcessor()
    effects?.setEffects(case.boost, case.trim)
    val encoding = if (case.pcm16) C.ENCODING_PCM_16BIT else C.ENCODING_PCM_FLOAT
    val outputFormat = processor.configure(AudioFormat(case.sampleRate, case.channels, encoding))
    assertEquals(AudioFormat(case.sampleRate, case.channels, C.ENCODING_PCM_FLOAT), outputFormat)
    processor.flush(StreamMetadata.DEFAULT)
    val input = case.rawInput()
    val collector = OutputCollector(case.output.size)
    val random = java.util.Random(seed)
    var fed = 0
    var target = 0
    var ended = false
    fun collect(): Boolean {
        val output = processor.output
        val count = output.remaining() / 4
        collector.add(output, output.position(), count)
        output.position(output.limit())
        return count > 0
    }
    fun feed() {
        while (fed < target) {
            val chunk = minOf(1 + random.nextInt(if (random.nextInt(4) == 0) 20_000 else 2_000), target - fed)
            input.limit((fed + chunk) * case.inputFrameBytes).position(fed * case.inputFrameBytes)
            while (input.hasRemaining()) {
                processor.queueInput(input)
                collect()
            }
            fed += chunk
        }
    }
    try {
        for (step in case.steps) {
            when (step) {
                is VectorStep.Process -> target += step.consumed
                is VectorStep.Configure -> {
                    feed()
                    effects!!.setEffects(step.boost, step.trim)
                }
                is VectorStep.Reset -> {
                    feed()
                    do {
                        processor.queueInput(AudioProcessor.EMPTY_BUFFER)
                    } while (collect())
                    val positionOffsetUs = (step.origin * 1_000_000 + case.sampleRate / 2) / case.sampleRate
                    processor.flush(StreamMetadata.Builder().setPositionOffsetUs(positionOffsetUs).build())
                    spans.startSegment()
                }
                is VectorStep.Finish -> if (!ended) {
                    feed()
                    ended = true
                    processor.queueEndOfStream()
                    while (!processor.isEnded) collect()
                }
            }
        }
    } finally {
        processor.reset()
    }
    return Replayed(collector.result(), if (case.effects) spans.spans else emptyList())
}

fun assertReplayed(case: VectorCase, replayed: Replayed) {
    val mismatch = (0 until minOf(case.output.size, replayed.output.size)).firstOrNull {
        case.output[it].toRawBits() != replayed.output[it].toRawBits()
    }
    assertEquals("${case.name} first differing sample", null, mismatch)
    assertEquals("${case.name} output samples", case.output.size, replayed.output.size)
    assertEquals("${case.name} spans", case.spans, replayed.spans)
}
