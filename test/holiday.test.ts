import test from "node:test";
import assert from "node:assert/strict";
import { getHolidayForDate, showHolidayMessage } from "../src/utils/holiday.ts";

const captureConsoleLog = (fn: () => void): string[] => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    fn();
    return logs;
  } finally {
    console.log = originalLog;
  }
};

const withMockedDate = (date: Date, fn: () => void): void => {
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) {
        return new RealDate(date);
      }
      return new RealDate(...args);
    }

    static now(): number {
      return date.getTime();
    }

    static parse(dateString: string): number {
      return RealDate.parse(dateString);
    }

    static UTC(
      ...args: Parameters<typeof Date.UTC>
    ): ReturnType<typeof Date.UTC> {
      return RealDate.UTC(...args);
    }
  } as DateConstructor;

  try {
    fn();
  } finally {
    global.Date = RealDate;
  }
};

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

test("showHolidayMessage prints a Christmas greeting", () => {
  const logs = captureConsoleLog(() => {
    withMockedDate(new Date(2024, 11, 24), () => {
      showHolidayMessage();
    });
  });

  assert(logs.some((line) => line.includes("H A P P Y   H O L I D A Y S")));
});

test("showHolidayMessage prints a New Year greeting for New Year's Eve", () => {
  const logs = captureConsoleLog(() => {
    withMockedDate(new Date(2024, 11, 31), () => {
      showHolidayMessage();
    });
  });

  assert(logs.some((line) => line.includes("H A P P Y   N E W   Y E A R")));
});

test("showHolidayMessage prints nothing on non-holidays", () => {
  const logs = captureConsoleLog(() => {
    withMockedDate(new Date(2024, 6, 10), () => {
      showHolidayMessage();
    });
  });

  assert.equal(logs.length, 0);
});
