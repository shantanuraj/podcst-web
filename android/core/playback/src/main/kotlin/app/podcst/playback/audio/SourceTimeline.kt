package app.podcst.playback.audio

class SourceTimeline(private val capacity: Int = 4096) {
    private val spanSource = LongArray(capacity)
    private val spanOutput = LongArray(capacity)
    private val spanFrames = IntArray(capacity)
    private var spanHead = 0
    private var spanCount = 0

    private val segmentOutput = LongArray(SEGMENTS)
    private val segmentEffects = LongArray(SEGMENTS)
    private val segmentSpeed = DoubleArray(SEGMENTS)
    private var segmentHead = 0
    private var segmentCount = 0

    private var anchorUs = 0L
    private var anchorFrame = 0L
    private var sampleRate = 0

    fun reset(anchorUs: Long, sampleRate: Int) {
        this.anchorUs = anchorUs
        this.sampleRate = sampleRate
        anchorFrame = originFrame(anchorUs, sampleRate)
        spanHead = 0
        spanCount = 0
        segmentHead = 0
        segmentCount = 1
        segmentOutput[0] = 0
        segmentEffects[0] = 0
        segmentSpeed[0] = 1.0
    }

    fun span(sourceStart: Long, outputStart: Long, frames: Int) {
        if (frames <= 0) return
        if (spanCount > 0) {
            val last = (spanHead + spanCount - 1) % capacity
            if (spanSource[last] + spanFrames[last] == sourceStart && spanOutput[last] + spanFrames[last] == outputStart &&
                spanFrames[last].toLong() + frames <= Int.MAX_VALUE
            ) {
                spanFrames[last] += frames
                return
            }
        }
        if (spanCount == capacity) {
            spanHead = (spanHead + 1) % capacity
            spanCount--
        }
        val slot = (spanHead + spanCount) % capacity
        spanSource[slot] = sourceStart
        spanOutput[slot] = outputStart
        spanFrames[slot] = frames
        spanCount++
    }

    fun speed(outputFrame: Long, effectsFrame: Long, speed: Double) {
        val last = (segmentHead + segmentCount - 1) % SEGMENTS
        if (segmentOutput[last] == outputFrame) {
            segmentEffects[last] = effectsFrame
            segmentSpeed[last] = speed
            return
        }
        if (segmentCount == SEGMENTS) {
            segmentHead = (segmentHead + 1) % SEGMENTS
            segmentCount--
        }
        val slot = (segmentHead + segmentCount) % SEGMENTS
        segmentOutput[slot] = outputFrame
        segmentEffects[slot] = effectsFrame
        segmentSpeed[slot] = speed
        segmentCount++
    }

    fun positionUs(outputFrame: Long): Long {
        if (sampleRate == 0) return anchorUs
        val source = sourceFrame(effectsFrame(maxOf(0, outputFrame))) ?: return anchorUs
        discardBefore(outputFrame)
        return anchorUs + (source - anchorFrame) * 1_000_000L / sampleRate
    }

    private fun effectsFrame(outputFrame: Long): Long {
        var index = segmentCount - 1
        while (index > 0 && segmentOutput[(segmentHead + index) % SEGMENTS] > outputFrame) index--
        val slot = (segmentHead + index) % SEGMENTS
        val elapsed = outputFrame - segmentOutput[slot]
        if (index + 1 < segmentCount) {
            val next = (segmentHead + index + 1) % SEGMENTS
            val span = segmentOutput[next] - segmentOutput[slot]
            if (span > 0) {
                return segmentEffects[slot] + (segmentEffects[next] - segmentEffects[slot]) * elapsed / span
            }
        }
        return segmentEffects[slot] + (elapsed * segmentSpeed[slot]).toLong()
    }

    private fun sourceFrame(effectsFrame: Long): Long? {
        if (spanCount == 0) return null
        var low = 0
        var high = spanCount - 1
        while (low < high) {
            val middle = (low + high + 1) ushr 1
            if (spanOutput[(spanHead + middle) % capacity] <= effectsFrame) low = middle else high = middle - 1
        }
        val slot = (spanHead + low) % capacity
        if (spanOutput[slot] > effectsFrame) return spanSource[slot]
        val offset = minOf(effectsFrame - spanOutput[slot], spanFrames[slot].toLong())
        return spanSource[slot] + offset
    }

    private fun discardBefore(outputFrame: Long) {
        val effects = effectsFrame(outputFrame)
        while (spanCount > 1) {
            val next = (spanHead + 1) % capacity
            if (spanOutput[next] > effects) break
            spanHead = next
            spanCount--
        }
        while (segmentCount > 1 && segmentOutput[(segmentHead + 1) % SEGMENTS] <= outputFrame) {
            segmentHead = (segmentHead + 1) % SEGMENTS
            segmentCount--
        }
    }

    companion object {
        private const val SEGMENTS = 64

        fun originFrame(positionUs: Long, sampleRate: Int): Long = Math.round(positionUs * sampleRate / 1_000_000.0)
    }
}
