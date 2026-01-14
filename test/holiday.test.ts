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

test("getHolidayForDate detects fixed-date holidays", () => {
  assert.equal(getHolidayForDate(new Date(2024, 0, 1)), "new-year");
  assert.equal(getHolidayForDate(new Date(2024, 1, 14)), "valentines");
  assert.equal(getHolidayForDate(new Date(2024, 9, 31)), "halloween");
  assert.equal(getHolidayForDate(new Date(2024, 11, 24)), "christmas");
  assert.equal(getHolidayForDate(new Date(2024, 11, 25)), "christmas");
  assert.equal(getHolidayForDate(new Date(2024, 11, 31)), "new-year-eve");
});

test("getHolidayForDate returns null for non-holiday dates", () => {
  assert.equal(getHolidayForDate(new Date(2024, 6, 10)), null);
});
