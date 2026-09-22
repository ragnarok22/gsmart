import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { createConfigCommand } from "../src/commands/config.ts";

type StdinSnapshot = {
  isTTY: boolean | undefined;
  setRawMode: ((mode: boolean) => void) | undefined;
  resume: () => NodeJS.ReadStream;
  pause: () => NodeJS.ReadStream;
  setEncoding: (encoding?: BufferEncoding) => NodeJS.ReadStream;
};

const serial = { concurrency: false };

const stripAnsi = (value: string) => {
  const escape = String.fromCharCode(27);
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === escape && value[index + 1] === "[") {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) break;
        index += 1;
      }
      continue;
    }

    result += value[index];
  }

  return result;
};

const normalizeConsoleEntries = (entries: string[]) =>
  entries.map((entry) => stripAnsi(entry).replace(/^\n/, ""));

const createSpinner = (events: { type: string; message?: string }[]) => {
  const spinner = {
    fail: (message?: string) => {
      events.push({ type: "fail", message: stripAnsi(message ?? "") });
      return spinner;
    },
    succeed: (message?: string) => {
      events.push({ type: "succeed", message: stripAnsi(message ?? "") });
      return spinner;
    },
    warn: (message?: string) => {
      events.push({ type: "warn", message: stripAnsi(message ?? "") });
      return spinner;
    },
  };
  return spinner;
};

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
  const events: { type: string; message?: string }[] = [];
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
    const ConfigCommand = createConfigCommand({
      prompt: async () => ({ action: "set" }),
      spinner: () => createSpinner(events) as never,
      promptConfig: {
        getPrompt: () => "",
        setPrompt: () => {
          setPromptCalled = true;
        },
        clearPrompt: () => ({ cleared: false }),
      },
    });

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
  assert.deepEqual(events, [{ type: "fail", message: "No prompt provided" }]);
  assert.match(logs.join("\n"), /non-interactively/i);
});

test(
  "config set accepts bracketed multi-line pasted prompts",
  serial,
  async () => {
    const tty = mockTtyInput();
    const writes: string[] = [];
    const events: { type: string; message?: string }[] = [];
    let savedPrompt = "";
    tty.setWriteSpy(writes);

    try {
      const ConfigCommand = createConfigCommand({
        prompt: async () => ({ action: "set" }),
        spinner: () => createSpinner(events) as never,
        promptConfig: {
          getPrompt: () => "",
          setPrompt: (prompt: string) => {
            savedPrompt = prompt;
          },
          clearPrompt: () => ({ cleared: false }),
        },
      });

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
    assert.deepEqual(events, [
      { type: "succeed", message: "Default prompt saved successfully" },
    ]);
    assert.match(writes.join(""), /Pasted text/);
  },
);

test("config set handles Ctrl+C dismissal without saving", serial, async () => {
  const tty = mockTtyInput();
  let setPromptCalls = 0;
  const events: { type: string; message?: string }[] = [];

  try {
    const ConfigCommand = createConfigCommand({
      prompt: async () => ({ action: "set" }),
      spinner: () => createSpinner(events) as never,
      promptConfig: {
        getPrompt: () => "",
        setPrompt: () => {
          setPromptCalls += 1;
        },
        clearPrompt: () => ({ cleared: false }),
      },
    });

    const actionPromise = ConfigCommand.action({});
    await new Promise((resolve) => setImmediate(resolve));
    process.stdin.emit("data", "\x03");
    await actionPromise;
  } finally {
    tty.restore();
  }

  assert.equal(setPromptCalls, 0);
  assert.deepEqual(events, [{ type: "fail", message: "No prompt provided" }]);
});

test(
  "config clear cancellation path reports operation cancelled",
  serial,
  async () => {
    const events: { type: string; message?: string }[] = [];
    let clearPromptCalls = 0;
    const promptsCalls: string[] = [];

    const ConfigCommand = createConfigCommand({
      prompt: async (question: unknown) => {
        const name = (question as { name: string }).name;
        promptsCalls.push(name);
        if (name === "action") return { action: "clear" };
        return { confirm: undefined };
      },
      spinner: () => createSpinner(events) as never,
      promptConfig: {
        getPrompt: () => "existing prompt",
        setPrompt: () => undefined,
        clearPrompt: () => {
          clearPromptCalls += 1;
          return { cleared: true };
        },
      },
    });

    await ConfigCommand.action({});

    assert.deepEqual(promptsCalls, ["action", "confirm"]);
    assert.equal(clearPromptCalls, 0);
    assert.deepEqual(events, [
      { type: "fail", message: "Operation cancelled" },
    ]);
  },
);

test("config flags match interactive equivalents", serial, async () => {
  const flagLogs: string[] = [];
  const interactiveLogs: string[] = [];
  const flagEvents: { type: string; message?: string }[] = [];
  const interactiveEvents: { type: string; message?: string }[] = [];
  const savedPrompts: string[] = [];
  let clearViaFlag = 0;
  let clearViaInteractive = 0;
  let interactiveActionCalls = 0;

  const flagCommand = createConfigCommand({
    prompt: async () => ({ action: "show" }),
    spinner: () => createSpinner(flagEvents) as never,
    log: (...args: unknown[]) => flagLogs.push(args.join(" ")),
    promptConfig: {
      getPrompt: () => "style: concise",
      setPrompt: (prompt: string) => {
        savedPrompts.push(prompt);
      },
      clearPrompt: () => {
        clearViaFlag += 1;
        return { cleared: true };
      },
    },
  });

  await flagCommand.action({ addCustomPrompt: "style: concise" });
  await flagCommand.action({ show: true });
  await flagCommand.action({ clearCustomPrompt: true });

  const interactiveCommand = createConfigCommand({
    prompt: async (question: unknown) => {
      const name = (question as { name: string }).name;
      if (name === "action") {
        interactiveActionCalls += 1;
        return { action: interactiveActionCalls === 1 ? "show" : "clear" };
      }
      return { confirm: true };
    },
    spinner: () => createSpinner(interactiveEvents) as never,
    log: (...args: unknown[]) => interactiveLogs.push(args.join(" ")),
    promptConfig: {
      getPrompt: () => "style: concise",
      setPrompt: () => undefined,
      clearPrompt: () => {
        clearViaInteractive += 1;
        return { cleared: true };
      },
    },
  });

  await interactiveCommand.action({});
  await interactiveCommand.action({});

  assert.deepEqual(savedPrompts, ["style: concise"]);
  assert.equal(clearViaFlag, 1);
  assert.equal(clearViaInteractive, 1);
  assert.deepEqual(flagEvents, [
    { type: "succeed", message: "Default prompt saved successfully" },
    { type: "succeed", message: "Default prompt cleared" },
  ]);
  assert.deepEqual(interactiveEvents, [
    { type: "succeed", message: "Default prompt cleared" },
  ]);
  assert.deepEqual(
    normalizeConsoleEntries(flagLogs),
    normalizeConsoleEntries(interactiveLogs),
  );
});

test("prompt-only updates display the final injected prompt state with --show", async () => {
  const logs: string[] = [];
  const events: { type: string; message?: string }[] = [];
  let savedPrompt = "Original instructions";
  const command = createConfigCommand({
    prompt: async () => assert.fail("Must not prompt"),
    spinner: () => createSpinner(events) as never,
    log: (...args: unknown[]) => logs.push(args.join(" ")),
    promptConfig: {
      getPrompt: () => savedPrompt,
      setPrompt: (prompt) => {
        savedPrompt = prompt;
      },
      clearPrompt: () => {
        const cleared = Boolean(savedPrompt);
        savedPrompt = "";
        return { cleared };
      },
    },
  });

  await command.action({ addCustomPrompt: "Updated instructions", show: true });
  assert.match(logs.join("\n"), /Updated instructions/);
  assert.doesNotMatch(logs.join("\n"), /Original instructions/);
  logs.length = 0;
  await command.action({ clearCustomPrompt: true, show: true });
  assert.match(logs.join("\n"), /No default prompt configured/);
  logs.length = 0;
  await command.action({ clearCustomPrompt: true, show: true });
  assert.match(logs.join("\n"), /Default provider:/);
  assert.equal(events.at(-1)?.type, "warn");
});

test("show honors injected provider getters without a snapshot API", async () => {
  const logs: string[] = [];
  const command = createConfigCommand({
    config: {
      getDefaultProvider: () => "custom",
      getModel: (provider: string) =>
        provider === "custom" ? "injected-model" : "",
      getKey: () => "secret-injected-key",
      getCustomBaseURL: () => "http://localhost:9876/v1",
      getOpenAIAuthMode: () => "oauth",
      getOpenAIOAuthTokens: () => null,
    } as never,
    promptConfig: {
      getPrompt: () => "Injected instructions",
      setPrompt: () => assert.fail("Must not save"),
      clearPrompt: () => assert.fail("Must not clear"),
    },
    setExitCode: () => assert.fail("Must not fail"),
    log: (...args: unknown[]) => logs.push(args.join(" ")),
  });
  await command.action({ show: true });
  const text = logs.join("\n");
  assert.match(text, /Default provider: custom/);
  assert.match(text, /Injected instructions/);
  assert.match(text, /model=injected-model \(saved\)/);
  assert.match(text, /Endpoint: http:\/\/localhost:9876\/v1/);
  assert.match(text, /ChatGPT OAuth/);
  assert.doesNotMatch(text, /secret-/);
});

for (const options of [
  { addCustomPrompt: "New instructions" },
  { clearCustomPrompt: true },
  { defaultProvider: "anthropic" },
  { clearDefaultProvider: true },
  { provider: "anthropic", model: "new-model" },
  { provider: "anthropic", clearModel: true },
  { provider: "custom", baseUrl: "http://localhost:1234/v1" },
  { provider: "custom", apiKey: "secret-key" },
  { provider: "custom", clearApiKey: true },
  { clearCustomEndpoint: true },
]) {
  test(`show-effective rejects mutations before reads or writes: ${JSON.stringify(options)}`, async () => {
    const events: { type: string; message?: string }[] = [];
    let exitCode = 0;
    const command = createConfigCommand({
      config: {} as never,
      spinner: () => createSpinner(events) as never,
      promptConfig: {
        getPrompt: () => assert.fail("Must reject before reading the prompt"),
        setPrompt: () => assert.fail("Must not save the prompt"),
        clearPrompt: () => assert.fail("Must not clear the prompt"),
      },
      loadEffectiveConventions: async () =>
        assert.fail("Must not resolve conventions"),
      setExitCode: (code) => {
        exitCode = code;
      },
    });
    await command.action({ ...options, showEffective: true });
    assert.equal(exitCode, 1);
    assert.match(events[0].message!, /--show-effective.*cannot be combined/i);
    assert.doesNotMatch(events[0].message!, /secret-key/);
  });
}

for (const scenario of [
  {
    name: "the action menu",
    responses: [{}],
    questions: ["action"],
    events: [{ type: "fail", message: "No option selected" }],
  },
  {
    name: "default provider selection",
    responses: [{ action: "provider" }, {}],
    questions: ["action", "provider"],
    events: [],
  },
  {
    name: "provider selection for a model",
    responses: [{ action: "model" }, {}],
    questions: ["action", "provider"],
    events: [],
  },
]) {
  test(`config cancellation at ${scenario.name} stops before further prompts or configuration access`, async (t) => {
    const questions: string[] = [];
    const events: { type: string; message?: string }[] = [];
    const accessConfig = t.mock.fn(() =>
      assert.fail("Cancellation must not read or write settings"),
    );
    const setExitCode = t.mock.fn();
    const command = createConfigCommand({
      prompt: async (question) => {
        assert.ok(!Array.isArray(question));
        questions.push(String(question.name));
        return scenario.responses[questions.length - 1] ?? {};
      },
      spinner: () => createSpinner(events) as never,
      config: {
        getModel: accessConfig,
        setModel: accessConfig,
        clearModel: accessConfig,
        setDefaultProvider: accessConfig,
        clearDefaultProvider: accessConfig,
      } as never,
      promptConfig: {
        getPrompt: accessConfig,
        setPrompt: accessConfig,
        clearPrompt: accessConfig,
      },
      readPromptInput: accessConfig,
      setExitCode,
    });

    await command.action({});

    assert.deepEqual(questions, scenario.questions);
    assert.equal(accessConfig.mock.callCount(), 0);
    assert.equal(setExitCode.mock.callCount(), 0);
    assert.deepEqual(events, scenario.events);
  });
}

test(
  "config save failure sets the process exit code and reports only the error message",
  serial,
  async (t) => {
    const originalExitCode = process.exitCode;
    const events: { type: string; message?: string }[] = [];
    const log = t.mock.fn();
    const unexpected = t.mock.fn(() =>
      assert.fail(
        "A failed save must stop before prompting or displaying settings",
      ),
    );
    const setPrompt = t.mock.fn(() => {
      throw new Error("Could not save default prompt", {
        cause: new Error("secret-storage-details"),
      });
    });
    const command = createConfigCommand({
      prompt: unexpected,
      spinner: () => createSpinner(events) as never,
      promptConfig: {
        getPrompt: unexpected,
        setPrompt,
        clearPrompt: unexpected,
      },
      config: {} as never,
      log,
    });

    try {
      process.exitCode = 0;
      await command.action({
        addCustomPrompt: "secret-prompt-text",
        show: true,
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = originalExitCode;
    }

    assert.deepEqual(
      setPrompt.mock.calls.map((call) => call.arguments),
      [["secret-prompt-text"]],
    );
    assert.equal(unexpected.mock.callCount(), 0);
    assert.equal(log.mock.callCount(), 0);
    assert.deepEqual(events, [
      { type: "fail", message: "Could not save default prompt" },
    ]);
    assert.doesNotMatch(JSON.stringify(events), /secret-/);
  },
);

test("config handles a non-Error prompt rejection as a command failure", async (t) => {
  const events: { type: string; message?: string }[] = [];
  const setExitCode = t.mock.fn();
  const command = createConfigCommand({
    prompt: async () => {
      throw "Configuration input closed";
    },
    spinner: () => createSpinner(events) as never,
    config: {} as never,
    setExitCode,
  });

  await command.action({});

  assert.deepEqual(
    setExitCode.mock.calls.map((call) => call.arguments),
    [[1]],
  );
  assert.deepEqual(events, [
    { type: "fail", message: "Configuration input closed" },
  ]);
});
