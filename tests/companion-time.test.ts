import { describe, expect, it } from "vitest"
import { parseCompanionTime, boundedCompanionSeek } from "../src/scripts/lib/companion-time"

describe("precise companion seeking", () => {
  it.each([["0", 0], ["90", 90], ["1:30", 90], ["1:23:45", 5025], [" 120:00 ", 7200]])("parses %s", (text, seconds) => {
    expect(parseCompanionTime(text as string)).toBe(seconds)
  })
  it.each(["", "-30", "1:99", "1:1", "1:60:00", "1e3", "Infinity", "1:20 trailing", "9999999", "1.5"]) ("rejects %s", text => {
    expect(parseCompanionTime(text)).toBeNull()
  })
  it("bounds relative seeks while refusing unknown or live timelines", () => {
    expect(boundedCompanionSeek(-30, 120)).toBe(0)
    expect(boundedCompanionSeek(150, 120)).toBe(120)
    expect(boundedCompanionSeek(60, 0)).toBeNull()
    expect(boundedCompanionSeek(60, 120, false)).toBeNull()
    expect(boundedCompanionSeek(NaN, 120)).toBeNull()
  })
})
