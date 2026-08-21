import { getPeriodStart } from "../../src/utils/getPeriodStart.js";

describe("getPeriodStart", () => {
  test("returns null for 'all'", () => {
    expect(getPeriodStart("all")).toBeNull();
  });

  test("returns null for undefined/unrecognized values", () => {
    expect(getPeriodStart(undefined)).toBeNull();
    expect(getPeriodStart("bogus")).toBeNull();
  });

  test("'today' returns start of today at 00:00:00.000", () => {
    const result = getPeriodStart("today");
    const now = new Date();
    expect(result.getFullYear()).toBe(now.getFullYear());
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  test("'week' returns Monday of the current week", () => {
    const result = getPeriodStart("week");
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getHours()).toBe(0);
  });

  test("'month' returns the 1st of the current month", () => {
    const result = getPeriodStart("month");
    const now = new Date();
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getFullYear()).toBe(now.getFullYear());
  });

  test("'year' returns Jan 1st of the current year", () => {
    const result = getPeriodStart("year");
    const now = new Date();
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
    expect(result.getFullYear()).toBe(now.getFullYear());
  });

  test("'week' never returns a date in the future relative to today", () => {
    const result = getPeriodStart("week");
    expect(result.getTime()).toBeLessThanOrEqual(new Date().getTime());
  });
});
