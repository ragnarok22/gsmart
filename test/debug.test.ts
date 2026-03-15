import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  enableDebug,
  isDebugEnabled,
  debugLog,
  debugTime,
  _resetForTesting,
} from "../src/utils/debug";

describe("debug", () => {
  let stderrWrite: ReturnType<typeof mock.fn>;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    _resetForTesting();
    stderrWrite = mock.fn(() => true);
    originalWrite = process.stderr.write;
    process.stderr.write =
      stderrWrite as unknown as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    _resetForTesting();
  });

  describe("isDebugEnabled", () => {
    it("returns false by default", () => {
      assert.equal(isDebugEnabled(), false);
    });

    it("returns true after enableDebug is called", () => {
      enableDebug();
      assert.equal(isDebugEnabled(), true);
    });
  });

  describe("debugLog", () => {
    it("does not write to stderr when debug is disabled", () => {
      debugLog("test", "hello");
      assert.equal(stderrWrite.mock.calls.length, 0);
    });

    it("writes to stderr when debug is enabled", () => {
      enableDebug();
      debugLog("test", "hello");
      assert.equal(stderrWrite.mock.calls.length, 1);
      const output = stderrWrite.mock.calls[0].arguments[0] as string;
      assert.ok(output.includes("[debug test]"));
      assert.ok(output.includes("hello"));
    });

    it("includes elapsed time in output", () => {
      enableDebug();
      debugLog("test", "msg");
      const output = stderrWrite.mock.calls[0].arguments[0] as string;
      assert.match(output, /\+\d+ms/);
    });
  });

  describe("debugTime", () => {
    it("returns a no-op function when debug is disabled", () => {
      const stop = debugTime("test");
      stop();
      assert.equal(stderrWrite.mock.calls.length, 0);
    });

    it("logs elapsed time when debug is enabled", () => {
      enableDebug();
      const stop = debugTime("timer");
      stop();
      assert.equal(stderrWrite.mock.calls.length, 1);
      const output = stderrWrite.mock.calls[0].arguments[0] as string;
      assert.ok(output.includes("[debug timer]"));
      assert.ok(output.includes("completed in"));
    });
  });

  describe("_resetForTesting", () => {
    it("resets debug state to disabled", () => {
      enableDebug();
      assert.equal(isDebugEnabled(), true);
      _resetForTesting();
      assert.equal(isDebugEnabled(), false);
    });
  });
});
