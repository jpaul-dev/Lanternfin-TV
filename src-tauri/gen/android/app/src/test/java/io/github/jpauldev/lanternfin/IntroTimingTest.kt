package io.github.jpauldev.lanternfin

import org.junit.Assert.*
import org.junit.Test

class IntroTimingTest {
  private fun response(start: String = "10000", end: String = "70000", episode: Int = 1) =
    """{"tmdb_id":1396,"type":"tv","season":1,"episode":$episode,"intro":[{"start_ms":$start,"end_ms":$end}]}"""

  @Test fun `accepts a matched episode and only activates inside its seekable intro`() {
    val timing = IntroTiming.fromRemote(response(), 1396, 1, 1, 2400000)!!
    assertFalse(timing.active(9999, 2400000, true))
    assertTrue(timing.active(10000, 2400000, true))
    assertFalse(timing.active(70000, 2400000, true))
    assertFalse(timing.active(20000, 2400000, false))
    assertFalse(timing.active(20000, -9223372036854775807, true))
    assertFalse(timing.active(20000, 2300000, true))
  }

  @Test fun `rejects wrong episodes movies missing markers and malformed replies`() {
    assertNull(IntroTiming.fromRemote(response(episode = 2), 1396, 1, 1, 2400000))
    assertNull(IntroTiming.fromRemote(response(), 999, 1, 1, 2400000))
    assertNull(IntroTiming.fromRemote(response().replace("tv", "movie"), 1396, 1, 1, 2400000))
    assertNull(IntroTiming.fromRemote("{}", 1396, 1, 1, 2400000))
    assertNull(IntroTiming.fromRemote("<html>error</html>", 1396, 1, 1, 2400000))
    assertNull(IntroTiming.fromRemote(response().replace("\"intro\"", "\"credits\""), 1396, 1, 1, 2400000))
  }

  @Test fun `rejects reversed excessive negative missing end and out of runtime timestamps`() {
    for ((start, end) in listOf("-1" to "70000", "70000" to "10000", "0" to "500000", "0" to "null", "0" to "1e30", "1.5" to "60000")) {
      assertNull(IntroTiming.fromRemote(response(start, end), 1396, 1, 1, 2400000))
    }
    assertNull(IntroTiming.fromRemote(response(), 1396, 1, 1, 60000))
    assertEquals(0L, IntroTiming.fromRemote(response("null"), 1396, 1, 1, 2400000)!!.startMs)
  }

  @Test fun `manual timing accepts clock notation and refuses ambiguous or overflowing values`() {
    assertEquals(83000L, IntroTiming.parseClock("1:23"))
    assertEquals(62000L, IntroTiming.parseClock("0:01:02"))
    for (raw in listOf("1:99", "-1:00", "abc", "90", "999:59:59", "1:00:00:00")) assertNull(IntroTiming.parseClock(raw))
    assertFalse(IntroTiming(80000, 10000, 2400000).matches(2400000))
    assertTrue(IntroTiming(10000, 80000, 2400000).matches(2400001))
  }
}
