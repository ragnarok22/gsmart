import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

type StdinSnapshot = {
  isTTY: boolean | undefined;
  setRawMode: ((mode: boolean) => void) | undefined;
  resume: () => void;
  pause: () => void;
  setEncoding: (encoding: BufferEncoding) => void;
};

const serial = { concurrency: false };

const mockTtyInput = () => {
  const stdin = process.stdin as NodeJS.ReadStream;
  const snapshot: StdinSnapshot = {
    isTTY: process.stdin.isTTY,
    setRawMode: process.stdin.setRawMode,
    resume: stdin.resume.bind(stdin),
    pause: stdin.pause.bind(stdin),
    setEncoding: stdin.setEncoding.bind(stdin),
  };

  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdin, "setRawMode", {
    value: () => undefined,
    configurable: true,
  });
  stdin.resume = () => stdin;
  stdin.pause = () => stdin;
  stdin.setEncoding = () => stdin;

  const originalClearLine = process.stdout.clearLine;
  const originalCursorTo = process.stdout.cursorTo;
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.clearLine = () => true;
  process.stdout.cursorTo = () => true;

  return {
    setWriteSpy: (writes: string[]) => {
      process.stdout.write = ((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return originalWrite(chunk);
      }) as typeof process.stdout.write;
    },
    restore: () => {
      Object.defineProperty(process.stdin, "isTTY", {
        value: snapshot.isTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdin, "setRawMode", {
        value: snapshot.setRawMode,
        configurable: true,
      });
      stdin.resume = snapshot.resume;
      stdin.pause = snapshot.pause;
      stdin.setEncoding = snapshot.setEncoding;
      stdin.removeAllListeners("data");
      process.stdout.clearLine = originalClearLine;
      process.stdout.cursorTo = originalCursorTo;
      process.stdout.write = originalWrite;
    },
  };
};

test("config set does not crash in non-tty environments", serial, async () => {
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
  assert.deepEqual(failures, ["No prompt provided"]);
  assert.match(logs.join("\n"), /non-interactively/i);
});

test(
  "config set accepts bracketed multi-line pasted prompts",
  serial,
  async () => {
    const tty = mockTtyInput();
    const writes: string[] = [];
    const successes: string[] = [];
    let savedPrompt = "";
    tty.setWriteSpy(writes);

    try {
      const ConfigCommand = (
        await esmock("../src/commands/config.ts", {
          prompts: async () => ({ action: "set" }),
          ora: () => ({
            fail: () => undefined,
            succeed: (message: string) => successes.push(message),
            warn: () => undefined,
          }),
          "../src/utils/prompt-config.ts": {
            getPrompt: () => "",
            setPrompt: (prompt: string) => {
              savedPrompt = prompt;
            },
            clearPrompt: () => ({ cleared: false }),
          },
        })
      ).default;

      const actionPromise = ConfigCommand.action({});
      await new Promise((resolve) => setImmediate(resolve));
      process.stdin.emit(
        "data",
        "\x1b[200~feat(parser): normalize lines\r\n\r\nkeep body as pasted\x1b[201~",
      );
      process.stdin.emit("data", "\r");
      await actionPromise;
    } finally {
      tty.restore();
    }

    assert.equal(
      savedPrompt,
      "feat(parser): normalize lines\n\nkeep body as pasted",
    );
    assert.deepEqual(successes, ["Default prompt saved successfully"]);
    assert.match(writes.join(""), /Pasted text/);
  },
);

test("config set handles Ctrl+C dismissal without saving", serial, async () => {
  const tty = mockTtyInput();
  let setPromptCalls = 0;
  const failures: string[] = [];

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
            setPromptCalls += 1;
          },
          clearPrompt: () => ({ cleared: false }),
        },
      })
    ).default;

    const actionPromise = ConfigCommand.action({});
    await new Promise((resolve) => setImmediate(resolve));
    process.stdin.emit("data", "\x03");
    await actionPromise;
  } finally {
    tty.restore();
  }

  assert.equal(setPromptCalls, 0);
  assert.deepEqual(failures, ["No prompt provided"]);
});

test(
  "config clear cancellation path reports operation cancelled",
  serial,
  async () => {
    const failures: string[] = [];
    let clearPromptCalls = 0;
    const promptsCalls: string[] = [];

    const ConfigCommand = (
      await esmock("../src/commands/config.ts", {
        prompts: async (question: { name: string }) => {
          promptsCalls.push(question.name);
          if (question.name === "action") {
            return { action: "clear" };
          }
          return { confirm: undefined };
        },
        ora: () => ({
          fail: (message: string) => failures.push(message),
          succeed: () => undefined,
          warn: () => undefined,
        }),
        "../src/utils/prompt-config.ts": {
          getPrompt: () => "existing prompt",
          setPrompt: () => undefined,
          clearPrompt: () => {
            clearPromptCalls += 1;
            return { cleared: true };
          },
        },
      })
    ).default;

    await ConfigCommand.action({});

    assert.deepEqual(promptsCalls, ["action", "confirm"]);
    assert.equal(clearPromptCalls, 0);
    assert.deepEqual(failures, ["Operation cancelled"]);
  },
);

test("config flags match interactive equivalents", serial, async () => {
  const flagLogs: string[] = [];
  const interactiveLogs: string[] = [];
  const flagSuccesses: string[] = [];
  const interactiveSuccesses: string[] = [];
  const savedPrompts: string[] = [];
  let clearViaFlag = 0;
  let clearViaInteractive = 0;
  let interactiveActionCalls = 0;

  const originalConsoleLog = console.log;
  try {
    const flagCommand = (
      await esmock("../src/commands/config.ts", {
        prompts: async () => ({ action: "show" }),
        ora: () => ({
          fail: () => undefined,
          succeed: (message: string) => flagSuccesses.push(message),
          warn: () => undefined,
        }),
        "../src/utils/prompt-config.ts": {
          getPrompt: () => "style: concise",
          setPrompt: (prompt: string) => {
            savedPrompts.push(prompt);
          },
          clearPrompt: () => {
            clearViaFlag += 1;
            return { cleared: true };
          },
        },
      })
    ).default;

    console.log = (...args: unknown[]) => flagLogs.push(args.join(" "));
    await flagCommand.action({ addCustomPrompt: "style: concise" });
    await flagCommand.action({ show: true });
    await flagCommand.action({ clearCustomPrompt: true });

    const interactiveCommand = (
      await esmock("../src/commands/config.ts", {
        prompts: async (question: { name: string }) => {
          if (question.name === "action") {
            interactiveActionCalls += 1;
            return { action: interactiveActionCalls === 1 ? "show" : "clear" };
          }
          return { confirm: true };
        },
        ora: () => ({
          fail: () => undefined,
          succeed: (message: string) => interactiveSuccesses.push(message),
          warn: () => undefined,
        }),
        "../src/utils/prompt-config.ts": {
          getPrompt: () => "style: concise",
          setPrompt: () => undefined,
          clearPrompt: () => {
            clearViaInteractive += 1;
            return { cleared: true };
          },
        },
      })
    ).default;

    console.log = (...args: unknown[]) => interactiveLogs.push(args.join(" "));
    await interactiveCommand.action({});
    await interactiveCommand.action({});
  } finally {
    console.log = originalConsoleLog;
  }

  assert.deepEqual(savedPrompts, ["style: concise"]);
  assert.equal(clearViaFlag, 1);
  assert.equal(clearViaInteractive, 1);
  assert.deepEqual(flagSuccesses, [
    "Default prompt saved successfully",
    "Default prompt cleared",
  ]);
  assert.deepEqual(interactiveSuccesses, ["Default prompt cleared"]);
  assert.deepEqual(
    flagLogs,
    interactiveLogs.map((entry) => entry.replace(/^\n/, "")),
  );
});
