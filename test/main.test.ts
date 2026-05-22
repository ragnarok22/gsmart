import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { createMainCommand } from "../src/commands/main.ts";
import { parseDiffFileNames } from "../src/utils/git.ts";

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
    promptsResponses?: Record<string, unknown>;
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
    commitResult = true,
    copyResult = true,
    providers = activeProviders,
    logs = [],
  } = overrides;

  const spinnerFactory = createSpinnerFactory();
  const aiCalls: { provider: string; prompt: string; branch: string }[] = [];
  let committedMessage = "";
  let clipboardText = "";

  class FakeAIBuilder {
    constructor(
      private readonly provider: string,
      private readonly prompt: string,
    ) {}

    generateCommitMessage(branchName: string) {
      aiCalls.push({
        provider: this.provider,
        prompt: this.prompt,
        branch: branchName,
      });
      return Promise.resolve(aiResult);
    }
  }

  const MainCommand = createMainCommand({
    spinner: spinnerFactory.spinner as never,
    prompt: async (opts: unknown) => {
      const name = (opts as { name: string }).name;
      if (name in promptsResponses) {
        return { [name]: promptsResponses[name] };
      }
      return {};
    },
    config: {
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
    retrieveFilesToCommit: async () => changes,
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
  });

  return {
    MainCommand,
    events: spinnerFactory.events,
    aiCalls,
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

test("main --yes uses first configured provider when multiple exist", async () => {
  const { MainCommand, getCommittedMessage, aiCalls } = buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
  });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "feat: test commit");
  assert.equal(aiCalls[0].provider, "openai");
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
  const { MainCommand, getCommittedMessage, events } = buildMainCommand({
    allKeys: {},
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
  assert(events.some((event) => event.message?.includes("No API keys found")));
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
  assert(events.some((event) => event.message?.includes("No valid provider")));
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

test("main fails when provider prompt is dismissed", async () => {
  const { MainCommand, getCommittedMessage } = buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
    promptsResponses: {},
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
});

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
