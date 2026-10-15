import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  describeOffset,
  formatTime,
  localDateKey,
  resolveInstant,
  toLocalInput,
  zonedLocalToUtc,
} from "@/lib/time";

describe("zonedLocalToUtc", () => {
  it("converts Paris summer time", () => {
    expect(zonedLocalToUtc("2027-06-24T18:05", "Europe/Paris")?.toISOString()).toBe("2027-06-24T16:05:00.000Z");
  });

  it("converts Florida winter and summer time", () => {
    expect(zonedLocalToUtc("2027-01-10T09:00", "America/New_York")?.toISOString()).toBe("2027-01-10T14:00:00.000Z");
    expect(zonedLocalToUtc("2027-07-10T09:00", "America/New_York")?.toISOString()).toBe("2027-07-10T13:00:00.000Z");
  });

  it("moves a time skipped by spring-forward to after the gap", () => {
    // 2027-03-14 02:30 does not exist in New York; 03:30 EDT is 07:30Z.
    expect(zonedLocalToUtc("2027-03-14T02:30", "America/New_York")?.toISOString()).toBe("2027-03-14T07:30:00.000Z");
  });

  it("handles valid times right after the DST switch", () => {
    expect(zonedLocalToUtc("2027-03-14T05:00", "America/New_York")?.toISOString()).toBe("2027-03-14T09:00:00.000Z");
  });

  it("rejects unknown zones and bad strings", () => {
    expect(zonedLocalToUtc("2027-06-24T18:05", "Mars/Olympus")).toBeNull();
    expect(zonedLocalToUtc("June 24", "Europe/Paris")).toBeNull();
  });
});

describe("resolveInstant", () => {
  it("trusts an explicit offset", () => {
    expect(resolveInstant("2027-06-25T08:05:00+02:00", null)?.toISOString()).toBe("2027-06-25T06:05:00.000Z");
  });
  it("reads wall-clock time in the given zone", () => {
    expect(resolveInstant("2027-06-25T08:05", "Europe/Paris")?.toISOString()).toBe("2027-06-25T06:05:00.000Z");
  });
});

describe("display helpers", () => {
  const instant = new Date("2027-06-25T06:05:00Z");
  it("formats local and Florida time for the same instant", () => {
    // ICU separates "AM" with a narrow no-break space.
    const plain = (s: string) => s.replace(/\s/g, " ");
    expect(plain(formatTime(instant, "Europe/Paris"))).toBe("8:05 AM");
    expect(plain(formatTime(instant, "America/New_York"))).toBe("2:05 AM");
  });
  it("computes local dates and offsets", () => {
    expect(localDateKey("2027-06-25T02:00:00Z", "America/New_York")).toBe("2027-06-24");
    expect(localDateKey("2027-06-25T02:00:00Z", "Europe/Paris")).toBe("2027-06-25");
    expect(addDaysToKey("2027-06-30", 1)).toBe("2027-07-01");
    expect(describeOffset("Paris", "Europe/Paris", "America/New_York", instant)).toBe(
      "Paris is 6 hours ahead of Florida",
    );
    expect(toLocalInput("2027-06-25T06:05:00Z", "Europe/Paris")).toBe("2027-06-25T08:05");
  });
});
