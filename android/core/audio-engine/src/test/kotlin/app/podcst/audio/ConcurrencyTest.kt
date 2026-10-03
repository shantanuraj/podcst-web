package app.podcst.audio

import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConcurrencyTest {
    private inline fun <T> retryBusy(busy: AtomicInteger, call: () -> T): T {
        while (true) {
            try {
                return call()
            } catch (error: AudioEngineException) {
                if (error.status != AudioStatus.BUSY) throw error
                busy.incrementAndGet()
            }
        }
    }

    @Test
    fun concurrentEntryFailsBusyAndNeverCorruptsTheStream() {
        val case = hostVector("effects-mono-8000-both")
        val busy = AtomicInteger()
        var attempts = 0
        while (busy.get() == 0 && attempts++ < 20) {
            EffectsProcessor(case.sampleRate, case.channels, case.boost, case.trim).use { effects ->
                val done = AtomicBoolean()
                val unexpected = AtomicReference<AudioEngineException>()
                val start = CountDownLatch(2)
                val observer = thread {
                    start.countDown()
                    start.await()
                    while (!done.get()) {
                        try {
                            effects.info()
                        } catch (error: AudioEngineException) {
                            if (error.status == AudioStatus.BUSY) busy.incrementAndGet() else unexpected.set(error)
                        }
                    }
                }
                start.countDown()
                start.await()
                val input = case.floatInput()
                val output = direct(MAX_BLOCK_FRAMES * 4)
                val spans = SpanBuffer()
                val collector = OutputCollector(case.output.size)
                while (input.hasRemaining()) {
                    input.limit(minOf(input.position() + 512 * 4, input.capacity()))
                    while (input.hasRemaining()) {
                        output.clear().limit(512 * 4)
                        val report = retryBusy(busy) { effects.process(input, output, spans) }
                        collector.add(output, 0, report.emittedFrames)
                    }
                    input.limit(input.capacity())
                }
                do {
                    output.clear().limit(512 * 4)
                    val report = retryBusy(busy) { effects.finish(output, spans) }
                    collector.add(output, 0, report.emittedFrames)
                } while (!report.finished)
                done.set(true)
                observer.join()
                assertNull(unexpected.get())
                assertReplayed(case, Replayed(collector.result(), case.spans))
            }
        }
        assertTrue(busy.get() > 0)
    }

    @Test
    fun closeIsRefusedWhileACallIsInFlight() {
        val input = speechPattern(48_000, 2, 1)
        var refused = 0
        repeat(100) {
            val effects = EffectsProcessor(48_000, 2, true, true)
            val start = CountDownLatch(2)
            var terminal: AudioStatus? = null
            val worker = thread {
                val output = direct(MAX_BLOCK_FRAMES * 8)
                val spans = SpanBuffer()
                start.countDown()
                start.await()
                while (terminal == null) {
                    try {
                        input.position(0)
                        effects.process(input, output.clear() as ByteBuffer, spans)
                        effects.reset(0)
                    } catch (error: AudioEngineException) {
                        if (error.status != AudioStatus.BUSY) terminal = error.status
                    }
                }
            }
            start.countDown()
            start.await()
            while (true) {
                try {
                    effects.close()
                    break
                } catch (error: AudioEngineException) {
                    assertEquals(AudioStatus.BUSY, error.status)
                    refused++
                }
            }
            worker.join()
            assertEquals(AudioStatus.CLOSED, terminal)
            assertEquals(AudioStatus.CLOSED, failure { effects.info() })
        }
        assertTrue(refused > 0)
    }
}
