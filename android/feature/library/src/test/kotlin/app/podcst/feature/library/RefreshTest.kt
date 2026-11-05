package app.podcst.feature.library

import java.net.SocketTimeoutException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RefreshTest {
    @Test fun successfulRetryClearsLibraryAndEpisodeListTimeoutState() = runTest {
        val state = MutableStateFlow(Refresh.Idle)
        refresh(state) { throw SocketTimeoutException("The request timed out") }
        testScheduler.runCurrent()
        assertEquals(Refresh.Failed, state.value)

        refresh(state) {}
        assertEquals(Refresh.Running, state.value)
        testScheduler.runCurrent()
        assertEquals(Refresh.Idle, state.value)
    }
}
