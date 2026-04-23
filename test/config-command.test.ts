import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

test("config set does not crash in non-tty environments", async () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = process.stdin.setRawMode;
  const logs: string[] = [];
  const failures: string[] = [];
  let setPromptCalled = false;

  Object.defineProperty(process.stdin, "isTTY", {
    value: false,
    configurable: true,
  });
  Object.defineProperty(process.stdin, "setRawMode", {
    value: undefined,
    configurable: true,
  });

  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));

  try {
    const ConfigCommand = (
      await esmock("../src/commands/config.ts", {
        prompts: async () => ({ action: "set" }),
        ora: () => ({
          fail: (message: string) => failures.push(message),
          succeed: () => undefined,
          warn: () => undefined,
        }),
        "../src/utils/prompt-config.ts": {
          getPrompt: () => "",
          setPrompt: () => {
            setPromptCalled = true;
          },
          clearPrompt: () => ({ cleared: false }),
        },
      })
    ).default;

    await ConfigCommand.action({});
  } finally {
    console.log = originalConsoleLog;
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "setRawMode", {
      value: originalSetRawMode,
      configurable: true,
    });
  }

  assert.equal(setPromptCalled, false);
  assert.equal(failures.length, 1);
  assert.match(logs.join("\n"), /non-interactively/i);
});

test("config set in non-tty mode reuses existing prompt as fallback", async () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = process.stdin.setRawMode;
  let savedPrompt = "";

  Object.defineProperty(process.stdin, "isTTY", {
    value: false,
    configurable: true,
  });
  Object.defineProperty(process.stdin, "setRawMode", {
    value: undefined,
    configurable: true,
  });

  try {
    const ConfigCommand = (
      await esmock("../src/commands/config.ts", {
        prompts: async () => ({ action: "set" }),
        ora: () => ({
          fail: () => undefined,
          succeed: () => undefined,
          warn: () => undefined,
        }),
        "../src/utils/prompt-config.ts": {
          getPrompt: () => "keep scope concise",
          setPrompt: (prompt: string) => {
            savedPrompt = prompt;
          },
          clearPrompt: () => ({ cleared: false }),
        },
      })
    ).default;

    await ConfigCommand.action({});
  } finally {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "setRawMode", {
      value: originalSetRawMode,
      configurable: true,
    });
  }

  assert.equal(savedPrompt, "keep scope concise");
});
