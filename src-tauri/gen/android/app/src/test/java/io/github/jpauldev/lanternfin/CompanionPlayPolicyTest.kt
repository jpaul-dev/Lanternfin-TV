package io.github.jpauldev.lanternfin

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CompanionPlayPolicyTest {
  @Test fun `never drops DRM or catchup offsets`() {
    assertTrue(CompanionPlayPolicy.supported(JSONObject("{}")))
    assertTrue(CompanionPlayPolicy.supported(JSONObject("""{"drm":null,"timelineOffsetSeconds":0}""")))
    assertFalse(CompanionPlayPolicy.supported(JSONObject("""{"drm":{"scheme":"widevine"}}""")))
    assertFalse(CompanionPlayPolicy.supported(JSONObject("""{"timelineOffsetSeconds":3600}""")))
  }
  @Test fun `bounds remote timestamps before converting to milliseconds`() {
    assertEquals(123000L, CompanionPlayPolicy.millis(123.0))
    assertEquals(0L, CompanionPlayPolicy.millis(Double.NaN))
    assertEquals(0L, CompanionPlayPolicy.millis(Double.POSITIVE_INFINITY))
    assertEquals(0L, CompanionPlayPolicy.millis(-30.0))
    assertEquals(604800000L, CompanionPlayPolicy.millis(1e30))
  }
  @Test fun `honors extensionless adaptive hints without treating TS streams as playlists`() {
    assertEquals("application/dash+xml", CompanionPlayPolicy.adaptiveMime("https://example.test/watch?id=1", "application/dash+xml"))
    assertEquals("application/x-mpegURL", CompanionPlayPolicy.adaptiveMime("https://example.test/watch", "application/vnd.apple.mpegurl"))
    assertNull(CompanionPlayPolicy.adaptiveMime("https://example.test/live/123.ts?token=a", "application/x-mpegURL"))
    assertNull(CompanionPlayPolicy.adaptiveMime("https://example.test/movie.mp4", "application/x-mpegURL"))
  }
}
