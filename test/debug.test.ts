import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  enableDebug,
  isDebugEnabled,
  debugLog,
  debugTime,
  redactCommandArgs,
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

  describe("redactCommandArgs", () => {
    for (const { name, args, expected } of [
      {
        name: "redacts a separate API key value",
        args: ["config", "--api-key", "placeholder-token", "--debug"],
        expected: ["config", "--api-key", "[REDACTED]", "--debug"],
      },
      {
        name: "redacts the entire inline value including extra equals signs",
        args: ["--api-key=placeholder=token==", "--debug"],
        expected: ["--api-key=[REDACTED]", "--debug"],
      },
      {
        name: "redacts every occurrence of mixed repeated options",
        args: [
          "--api-key",
          "first-placeholder",
          "--api-key=second-placeholder",
          "--api-key",
          "third-placeholder",
          "--debug",
        ],
        expected: [
          "--api-key",
          "[REDACTED]",
          "--api-key=[REDACTED]",
          "--api-key",
          "[REDACTED]",
          "--debug",
        ],
      },
      {
        name: "redacts required values that look like options or delimiters",
        args: [
          "--api-key",
          "--placeholder-token",
          "--api-key",
          "--",
          "--debug",
        ],
        expected: [
          "--api-key",
          "[REDACTED]",
          "--api-key",
          "[REDACTED]",
          "--debug",
        ],
      },
      {
        name: "does not expose values after adjacent sensitive option tokens",
        args: ["--api-key", "--api-key", "placeholder-token", "--debug"],
        expected: ["--api-key", "[REDACTED]", "[REDACTED]", "--debug"],
      },
      {
        name: "redacts empty values without consuming the following flag",
        args: ["--api-key", "", "--api-key=", "--debug"],
        expected: [
          "--api-key",
          "[REDACTED]",
          "--api-key=[REDACTED]",
          "--debug",
        ],
      },
      {
        name: "redacts whitespace and newlines inside a single argument",
        args: ["--api-key", "placeholder token\nwith newline", "--debug"],
        expected: ["--api-key", "[REDACTED]", "--debug"],
      },
      {
        name: "conservatively redacts credential-shaped arguments after a delimiter",
        args: ["--", "--api-key=placeholder-token"],
        expected: ["--", "--api-key=[REDACTED]"],
      },
      {
        name: "handles a missing value",
        args: ["config", "--debug", "--api-key"],
        expected: ["config", "--debug", "--api-key"],
      },
      {
        name: "handles empty arguments",
        args: [],
        expected: [],
      },
    ]) {
      it(name, () => {
        const original = [...args];
        assert.deepEqual(redactCommandArgs(Object.freeze(args)), expected);
        assert.deepEqual(args, original);
      });
    }

    it("preserves useful non-sensitive arguments and similarly named flags", () => {
      const args = [
        "config",
        "--provider",
        "custom",
        "--model=local-model",
        "--base-url",
        "http://localhost:1234/v1",
        "--clear-api-key",
        "--api-key-extra=value",
        "--debug",
      ];
      assert.deepEqual(redactCommandArgs(args), args);
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
