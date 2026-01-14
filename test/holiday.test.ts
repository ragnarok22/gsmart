import test from "node:test";
import assert from "node:assert/strict";
import { getHolidayForDate } from "../src/utils/holiday.ts";

test("getHolidayForDate detects Easter Sunday by year", () => {
  assert.equal(getHolidayForDate(new Date(2024, 2, 31)), "easter");
  assert.equal(getHolidayForDate(new Date(2025, 3, 20)), "easter");
});

test("getHolidayForDate detects Thanksgiving by year", () => {
  assert.equal(getHolidayForDate(new Date(2024, 10, 28)), "thanksgiving");
  assert.equal(getHolidayForDate(new Date(2023, 10, 23)), "thanksgiving");
});

test("getHolidayForDate returns null for non-holiday dates", () => {
  assert.equal(getHolidayForDate(new Date(2024, 6, 10)), null);
});
