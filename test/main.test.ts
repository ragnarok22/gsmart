import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import prompts from "prompts";
import { createMainCommand } from "../src/commands/main.ts";
import { parseDiffFileNames } from "../src/utils/git.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import type { GenerationOptions } from "../src/utils/ai.ts";
import type { ContextReport } from "../src/utils/diff-context.ts";

const normalizeMessage = (message?: string) =>
  message === undefined ? undefined : stripVTControlCharacters(message);

const activeProviders = [
  { title: "OpenAI", value: "openai", description: "OpenAI", active: true },
  {
    title: "Anthropic",
    value: "anthropic",
    description: "Anthropic",
    active: true,
  },
];

const createSpinnerFactory = () => {
  const events: { type: string; message?: string }[] = [];
  const spinner = {
    isSpinning: true,
    text: "",
    start() {
      spinner.isSpinning = true;
      events.push({ type: "start" });
      return spinner;
    },
    stop() {
      spinner.isSpinning = false;
      events.push({ type: "stop" });
      return spinner;
    },
    fail(message?: string) {
      spinner.isSpinning = false;
      events.push({ type: "fail", message: normalizeMessage(message) });
      return spinner;
    },
    succeed(message?: string) {
      spinner.isSpinning = false;
      events.push({ type: "succeed", message: normalizeMessage(message) });
      return spinner;
    },
    info(message?: string) {
      events.push({ type: "info", message: normalizeMessage(message) });
      return spinner;
    },
    warn(message?: string) {
      events.push({ type: "warn", message: normalizeMessage(message) });
      return spinner;
    },
  };

  return {
    events,
    spinner: () => spinner,
  };
};

function buildMainCommand(
  overrides: {
    changes?: string | null;
    branch?: string;
    allKeys?: Record<string, string>;
    openAIAuthMode?: "api-key" | "oauth";
    hasOpenAIOAuthTokens?: boolean;
    configuredPrompt?: string;
    aiResult?: string | { error: string };
    contextReport?: ContextReport;
    retrieve?: () => Promise<string | null>;
    promptsResponses?: Record<string, unknown>;
    prompt?: (
      question: Parameters<typeof prompts>[0],
    ) => Promise<Record<string, unknown>>;
    commitResult?: boolean;
    copyResult?: boolean;
    providers?: typeof activeProviders;
    logs?: string[];
  } = {},
) {
  const {
    changes = "diff content",
    branch = "main",
    allKeys = { openai: "sk-key" },
    openAIAuthMode = "api-key",
    hasOpenAIOAuthTokens = false,
    configuredPrompt = "",
    aiResult = "feat: test commit",
    promptsResponses = {},
    prompt,
    commitResult = true,
    copyResult = true,
    providers = activeProviders,
    logs = [],
  } = overrides;

  const spinnerFactory = createSpinnerFactory();
  const aiCalls: { provider: string; prompt: string; branch: string }[] = [];
  const exitCodes: number[] = [];
  const questions: string[] = [];
  let committedMessage = "";
  let clipboardText = "";

  class FakeAIBuilder {
    constructor(
      private readonly provider: string,
      private readonly prompt: string,
    ) {}

    generateCommitMessage(
      branchName: string,
      _changes: string,
      options?: GenerationOptions,
    ) {
      aiCalls.push({
        provider: this.provider,
        prompt: this.prompt,
        branch: branchName,
      });
      if (overrides.contextReport)
        options?.onContextPrepared?.(overrides.contextReport);
      return Promise.resolve(aiResult);
    }
  }

  const MainCommand = createMainCommand({
    loadEffectiveConventions: async ({ user = {}, cli = {} } = {}) =>
      resolveConventions([
        { source: "user", settings: user },
        { source: "CLI", settings: cli },
      ]),
    spinner: spinnerFactory.spinner as never,
    prompt: async (opts) => {
      const name = (opts as { name: string }).name;
      questions.push(name);
      if (prompt) return prompt(opts);
      if (name in promptsResponses) {
        return { [name]: promptsResponses[name] };
      }
      return {};
    },
    config: {
      getDefaultProvider: () => undefined,
      getModel: () => "",
      getAllKeys: () => allKeys,
      getKey: (provider: string) => allKeys[provider] ?? "",
      getOpenAIAuthMode: () => openAIAuthMode,
      getOpenAIOAuthTokens: () =>
        hasOpenAIOAuthTokens
          ? {
              idToken: "id-token",
              accessToken: "access-token",
              refreshToken: "refresh-token",
            }
          : null,
      getPrompt: () => configuredPrompt,
    } as never,
    AIBuilder: FakeAIBuilder as never,
    getActiveProviders: () => providers as never,
    retrieveFilesToCommit: overrides.retrieve ?? (async () => changes),
    getStagedSnapshot: async () => ({
      diff: changes ?? "",
      branch,
      fingerprint: "staged",
    }),
    getGitBranch: async () => branch,
    commitChanges: async (msg: string) => {
      committedMessage = msg;
      return commitResult;
    },
    copyToClipboard: async (text: string) => {
      clipboardText = text;
      return copyResult;
    },
    parseDiffFileNames,
    debugLog: () => undefined,
    debugTime: () => () => undefined,
    log: (...args: unknown[]) =>
      logs.push(stripVTControlCharacters(args.map(String).join(" "))),
    setExitCode: (code) => {
      exitCodes.push(code);
    },
  });

  return {
    MainCommand,
    events: spinnerFactory.events,
    aiCalls,
    exitCodes,
    questions,
    logs,
    getCommittedMessage: () => committedMessage,
    getClipboardText: () => clipboardText,
  };
}

test("main --yes commits automatically without prompting", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand();

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "feat: test commit");
  assert.deepEqual(aiCalls, [
    { provider: "openai", prompt: "", branch: "main" },
  ]);
});

test("main starts file retrieval and branch lookup concurrently", async () => {
  let resolveChanges!: (changes: string) => void;
  const changesPromise = new Promise<string>((resolve) => {
    resolveChanges = resolve;
  });
  let branchRequested = false;
  const spinnerFactory = createSpinnerFactory();

  class FakeAIBuilder {
    generateCommitMessage() {
      return Promise.resolve("feat: test commit");
    }
  }

  const MainCommand = createMainCommand({
    loadEffectiveConventions: async () => resolveConventions(),
    spinner: spinnerFactory.spinner as never,
    prompt: async () => ({}),
    config: {
      getDefaultProvider: () => undefined,
      getModel: () => "",
      getAllKeys: () => ({ openai: "sk-key" }),
      getKey: () => "sk-key",
      getOpenAIAuthMode: () => "api-key",
      getOpenAIOAuthTokens: () => null,
      getPrompt: () => "",
    } as never,
    AIBuilder: FakeAIBuilder as never,
    getActiveProviders: () => [activeProviders[0]] as never,
    retrieveFilesToCommit: async () => changesPromise,
    getStagedSnapshot: async () => ({
      diff: "diff content",
      branch: "main",
      fingerprint: "staged",
    }),
    getGitBranch: async () => {
      branchRequested = true;
      return "main";
    },
    commitChanges: async () => true,
    copyToClipboard: async () => true,
    parseDiffFileNames,
    debugLog: () => undefined,
    debugTime: () => () => undefined,
    log: () => undefined,
  });

  const actionPromise = MainCommand.action({ yes: true });
  await Promise.resolve();

  try {
    assert.equal(branchRequested, true);
  } finally {
    resolveChanges("diff content");
    await actionPromise;
  }
});

test("main --yes uses first configured provider when multiple exist", async () => {
  const { MainCommand, getCommittedMessage, aiCalls, questions } =
    buildMainCommand({
      allKeys: { openai: "sk-key", anthropic: "ak-key" },
    });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "feat: test commit");
  assert.equal(aiCalls[0].provider, "openai");
  assert.deepEqual(questions, []);
});

test("main exits early when no staged changes are available", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand({
    changes: null,
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
  assert.deepEqual(aiCalls, []);
});

test("main fails when no API keys are configured", async () => {
  const { MainCommand, getCommittedMessage, events, exitCodes, questions } =
    buildMainCommand({
      allKeys: {},
    });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
  assert.deepEqual(exitCodes, [1]);
  assert.deepEqual(questions, []);
  assert(
    events.some((event) =>
      event.message?.includes("No configured providers found"),
    ),
  );
});

test("main uses OpenAI when ChatGPT OAuth is configured without an API key", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand({
    allKeys: {},
    openAIAuthMode: "oauth",
    hasOpenAIOAuthTokens: true,
  });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "feat: test commit");
  assert.deepEqual(aiCalls, [
    { provider: "openai", prompt: "", branch: "main" },
  ]);
});

test("main uses explicit provider when specified", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
    promptsResponses: { action: "commit" },
  });

  await MainCommand.action({ provider: "openai" });

  assert.equal(getCommittedMessage(), "feat: test commit");
  assert.equal(aiCalls[0].provider, "openai");
});

test("main fails with invalid explicit provider", async () => {
  const { MainCommand, getCommittedMessage, events } = buildMainCommand({
    allKeys: { openai: "sk-key" },
  });

  await MainCommand.action({ provider: "invalid" });

  assert.equal(getCommittedMessage(), "");
  assert(events.some((event) => event.message?.includes("Unknown provider")));
});

test("main stops when AI returns an error", async () => {
  const { MainCommand, getCommittedMessage, events } = buildMainCommand({
    aiResult: { error: "API rate limit exceeded" },
  });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "");
  assert(events.some((event) => event.message === "API rate limit exceeded"));
});

test("main commits when user selects commit action", async () => {
  const { MainCommand, getCommittedMessage } = buildMainCommand({
    promptsResponses: { value: "openai", action: "commit" },
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "feat: test commit");
});

test("main copies to clipboard when user selects copy action", async () => {
  const { MainCommand, getClipboardText } = buildMainCommand({
    promptsResponses: { value: "openai", action: "copy" },
  });

  await MainCommand.action({});

  assert.equal(getClipboardText(), "feat: test commit");
});

test("main does nothing when user selects nothing action", async () => {
  const { MainCommand, getCommittedMessage, getClipboardText } =
    buildMainCommand({
      promptsResponses: { value: "openai", action: "nothing" },
    });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
  assert.equal(getClipboardText(), "");
});

test("main exits when no action selected", async () => {
  const { MainCommand, getCommittedMessage, events } = buildMainCommand({
    promptsResponses: { value: "openai" },
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
  assert(events.some((event) => event.message?.includes("No action selected")));
});

test("main copies message to clipboard when commit fails", async () => {
  const { MainCommand, getClipboardText } = buildMainCommand({
    commitResult: false,
    promptsResponses: { value: "openai", action: "commit" },
  });

  await MainCommand.action({});

  assert.equal(getClipboardText(), "feat: test commit");
});

test("main command has correct metadata", () => {
  const { MainCommand } = buildMainCommand();

  assert.equal(MainCommand.name, "generate");
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--prompt")));
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--provider")));
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--yes")));
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--dry-run")));
});

test("main --dry-run shows message without committing", async () => {
  const { MainCommand, getCommittedMessage } = buildMainCommand();

  await MainCommand.action({ dryRun: true, yes: true });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run exits before action prompt", async () => {
  const { MainCommand, getCommittedMessage, getClipboardText } =
    buildMainCommand({
      promptsResponses: { value: "openai" },
    });

  await MainCommand.action({ dryRun: true });

  assert.equal(getCommittedMessage(), "");
  assert.equal(getClipboardText(), "");
});

test("main --dry-run works with --provider flag", async () => {
  const { MainCommand, getCommittedMessage } = buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
  });

  await MainCommand.action({ dryRun: true, provider: "openai" });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run passes custom prompt to AI", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand();

  await MainCommand.action({
    dryRun: true,
    prompt: "custom prompt",
    yes: true,
  });

  assert.equal(getCommittedMessage(), "");
  assert.equal(aiCalls[0].prompt, "custom prompt");
});

test("main uses configured prompt when no prompt flag is provided", async () => {
  const { MainCommand, aiCalls } = buildMainCommand({
    configuredPrompt: "configured prompt",
  });

  await MainCommand.action({ dryRun: true, yes: true });

  assert.equal(aiCalls[0].prompt, "configured prompt");
});

test("main --dry-run exits early when no staged changes", async () => {
  const { MainCommand, getCommittedMessage } = buildMainCommand({
    changes: null,
  });

  await MainCommand.action({ dryRun: true });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run still fails when AI returns error", async () => {
  const { MainCommand, getCommittedMessage } = buildMainCommand({
    aiResult: { error: "API rate limit exceeded" },
  });

  await MainCommand.action({ dryRun: true, yes: true });

  assert.equal(getCommittedMessage(), "");
});

test("main logs message when commit and clipboard both fail", async () => {
  const logs: string[] = [];
  const { MainCommand } = buildMainCommand({
    commitResult: false,
    copyResult: false,
    promptsResponses: { value: "openai", action: "commit" },
    logs,
  });

  await MainCommand.action({});

  assert.ok(logs.some((line) => line.includes("feat: test commit")));
});

test("main logs message when clipboard copy fails in copy action", async () => {
  const logs: string[] = [];
  const { MainCommand } = buildMainCommand({
    copyResult: false,
    promptsResponses: { value: "openai", action: "copy" },
    logs,
  });

  await MainCommand.action({});

  assert.ok(logs.some((line) => line.includes("feat: test commit")));
});

test("main prompts for provider when multiple are configured", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
    promptsResponses: { value: "anthropic", action: "commit" },
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "feat: test commit");
  assert.equal(aiCalls[0].provider, "anthropic");
});

for (const dryRun of [false, true]) {
  test(`main exits normally when the provider prompt is canceled (dryRun=${dryRun})`, async () => {
    const {
      MainCommand,
      getCommittedMessage,
      getClipboardText,
      aiCalls,
      events,
      exitCodes,
      questions,
    } = buildMainCommand({
      allKeys: { openai: "sk-key", anthropic: "ak-key" },
      promptsResponses: {},
    });

    await MainCommand.action({ dryRun });

    assert.deepEqual(questions, ["value"]);
    assert.deepEqual(exitCodes, [], "cancellation must not signal a failure");
    assert.deepEqual(aiCalls, []);
    assert.equal(getCommittedMessage(), "");
    assert.equal(getClipboardText(), "");
    assert.ok(events.every((event) => event.type !== "fail"));
    assert.doesNotMatch(
      events.map((event) => event.message ?? "").join("\n"),
      /No configured providers|No valid provider|gsmart login|--base-url/,
    );
  });

  test(
    `main exits normally on real provider prompt Escape (dryRun=${dryRun})`,
    { timeout: 5000 },
    async (t) => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      t.after(() => {
        stdin.destroy();
        stdout.destroy();
      });
      const {
        MainCommand,
        getCommittedMessage,
        getClipboardText,
        aiCalls,
        events,
        exitCodes,
        questions,
        logs,
      } = buildMainCommand({
        allKeys: { openai: "sk-key", anthropic: "ak-key" },
        prompt: async (question) => {
          assert.ok(!Array.isArray(question));
          assert.equal(question.name, "value");
          const response = prompts({ ...question, stdin, stdout });
          setImmediate(() => stdin.write("\x1b"));
          return response;
        },
      });

      await MainCommand.action({ dryRun });

      assert.deepEqual(questions, ["value"]);
      assert.deepEqual(exitCodes, []);
      assert.deepEqual(aiCalls, []);
      assert.equal(getCommittedMessage(), "");
      assert.equal(getClipboardText(), "");
      assert.ok(events.every((event) => event.type !== "fail"));
      assert.doesNotMatch(
        [...logs, ...events.map((event) => event.message ?? "")].join("\n"),
        /No configured providers|No valid provider|gsmart login|--base-url/,
      );
    },
  );
}

test("main treats an explicitly undefined provider answer as cancellation", async () => {
  const { MainCommand, exitCodes, aiCalls, events, questions } =
    buildMainCommand({
      allKeys: { openai: "sk-key", anthropic: "ak-key" },
      promptsResponses: { value: undefined },
    });

  await MainCommand.action({});

  assert.deepEqual(questions, ["value"]);
  assert.deepEqual(exitCodes, []);
  assert.deepEqual(aiCalls, []);
  assert.ok(events.every((event) => event.type !== "fail"));
});

for (const value of ["gemini", "", null, false, 0]) {
  test(`main rejects a non-listed provider answer: ${JSON.stringify(value)}`, async () => {
    const {
      MainCommand,
      getCommittedMessage,
      getClipboardText,
      exitCodes,
      aiCalls,
      events,
      questions,
    } = buildMainCommand({
      allKeys: { openai: "sk-key", anthropic: "ak-key" },
      promptsResponses: { value },
    });

    await MainCommand.action({});

    assert.deepEqual(questions, ["value"]);
    assert.deepEqual(exitCodes, [1]);
    assert.deepEqual(aiCalls, []);
    assert.equal(getCommittedMessage(), "");
    assert.equal(getClipboardText(), "");
    assert.ok(
      events.some(
        (event) =>
          event.type === "fail" && event.message?.includes("No valid provider"),
      ),
    );
    assert.ok(
      events.every(
        (event) => !event.message?.includes("No configured providers"),
      ),
    );
  });
}

test("main --dry-run lists staged file names from diff headers", async () => {
  const diffWithHeaders = [
    "diff --git a/src/foo.ts b/src/foo.ts",
    "+const x = 1;",
    "diff --git a/src/bar.ts b/src/bar.ts",
    "+const y = 2;",
  ].join("\n");

  const logs: string[] = [];
  const { MainCommand } = buildMainCommand({ changes: diffWithHeaders, logs });

  await MainCommand.action({ dryRun: true, yes: true });

  assert.ok(logs.some((line) => line.includes("src/foo.ts")));
  assert.ok(logs.some((line) => line.includes("src/bar.ts")));
});

for (const failure of [
  new Error("Staged diff exceeds the 64 MiB capture limit"),
  "Git index could not be read",
]) {
  test(`staged diff read failures stop automation before generation or committing: ${String(failure)}`, async () => {
    const run = buildMainCommand({
      retrieve: async () => {
        throw failure;
      },
    });
    await run.MainCommand.action({ yes: true });
    assert.deepEqual(run.exitCodes, [1]);
    assert.deepEqual(run.aiCalls, []);
    assert.deepEqual(run.questions, []);
    assert.equal(run.getCommittedMessage(), "");
    assert.equal(run.getClipboardText(), "");
    assert.ok(
      run.events.some(
        (event) =>
          event.type === "fail" &&
          event.message ===
            `Could not read staged changes: ${failure instanceof Error ? failure.message : failure}`,
      ),
    );
  });
}

test("context inspection reports file treatments while dry-run still lists every staged file", async () => {
  const report: ContextReport = {
    budgetTokens: 8192,
    budgetSource: "override",
    inputTokens: 3000,
    outputTokens: 1024,
    overheadTokens: 512,
    summaryRequests: 0,
    files: [
      {
        path: "source.ts",
        kind: "source",
        treatment: "condensed",
        reason: "input budget; representative excerpts",
        originalBytes: 20000,
        contextBytes: 1000,
        partial: true,
      },
      {
        path: "excluded.txt",
        kind: "source",
        treatment: "excluded",
        reason: "context exclusion pattern",
        originalBytes: 500,
        contextBytes: 0,
        partial: true,
      },
    ],
  };
  for (const showContext of [false, true]) {
    const run = buildMainCommand({
      changes:
        "diff --git a/source.ts b/source.ts\n+change\ndiff --git a/excluded.txt b/excluded.txt\n+excluded\n",
      contextReport: report,
    });
    await run.MainCommand.action({ dryRun: true, showContext });
    assert.deepEqual(run.exitCodes, []);
    assert.equal(run.getCommittedMessage(), "");
    assert.ok(
      run.events.some(
        (event) =>
          event.type === "info" &&
          /AI context reduced for 2 file\(s\); staged changes preserved/.test(
            event.message ?? "",
          ),
      ),
    );
    const details = run.logs.find((line) => line.startsWith("{"));
    if (showContext)
      assert.deepEqual(JSON.parse(details!), { context: report });
    else assert.equal(details, undefined);
    assert.ok(run.logs.some((line) => line.includes("feat: test commit")));
    assert.ok(run.logs.some((line) => line.includes("source.ts")));
    assert.ok(run.logs.some((line) => line.includes("excluded.txt")));
  }
});

test("full-context inspection reports the original coverage without a reduction notice", async () => {
  const report: ContextReport = {
    budgetTokens: 8192,
    budgetSource: "fallback",
    inputTokens: 2000,
    outputTokens: 1024,
    overheadTokens: 512,
    summaryRequests: 0,
    files: [
      {
        path: "small.ts",
        kind: "source",
        treatment: "full",
        reason: "fits budget",
        originalBytes: 100,
        contextBytes: 100,
        partial: false,
      },
    ],
  };
  const run = buildMainCommand({ contextReport: report });
  await run.MainCommand.action({ dryRun: true, showContext: true });
  assert.deepEqual(JSON.parse(run.logs.find((line) => line.startsWith("{"))!), {
    context: report,
  });
  assert.ok(
    !run.events.some((event) => event.message?.includes("AI context reduced")),
  );
});
