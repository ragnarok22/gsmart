import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

// ---------------------------------------------------------------------------
// Stubs shared across tests
// ---------------------------------------------------------------------------
const oraStub = () => {
  const spinner = {
    isSpinning: true,
    start() {
      spinner.isSpinning = true;
      return spinner;
    },
    stop() {
      spinner.isSpinning = false;
      return spinner;
    },
    fail() {
      spinner.isSpinning = false;
      return spinner;
    },
    succeed() {
      spinner.isSpinning = false;
      return spinner;
    },
    info() {
      return spinner;
    },
  };
  return spinner;
};

async function buildMainCommand(overrides: {
  changes?: string | null;
  branch?: string;
  allKeys?: Record<string, string>;
  aiResult?: string | { error: string };
  promptsResponses?: Record<string, unknown>;
  commitResult?: boolean;
  stagedFileNames?: string[];
}) {
  const {
    changes = "diff content",
    branch = "main",
    allKeys = { openai: "sk-key" },
    aiResult = "feat: test commit",
    promptsResponses = {},
    commitResult = true,
    stagedFileNames = ["file1.txt", "file2.txt"],
  } = overrides;

  let committedMessage = "";
  let clipboardText = "";

  const MainCommand = (
    await esmock("../src/commands/main.ts", {
      ora: oraStub,
      prompts: async (opts: { name: string }) => {
        if (opts.name in promptsResponses) {
          return { [opts.name]: promptsResponses[opts.name] };
        }
        return {};
      },
      "../src/utils/git.ts": {
        getGitBranch: async () => branch,
        commitChanges: async (msg: string) => {
          committedMessage = msg;
          return commitResult;
        },
        getStagedFileNames: async () => stagedFileNames,
      },
      "../src/utils/config.ts": {
        default: {
          getAllKeys: () => allKeys,
          getKey: (provider: string) =>
            allKeys[provider as keyof typeof allKeys] ?? "",
          getPrompt: () => "",
        },
      },
      "../src/utils/ai.ts": {
        AIBuilder: class {
          generateCommitMessage() {
            return Promise.resolve(aiResult);
          }
        },
      },
      "../src/utils/providers.ts": {
        getActiveProviders: () => [
          { title: "OpenAI", value: "openai", active: true },
          { title: "Anthropic", value: "anthropic", active: true },
        ],
      },
      "../src/utils/index.ts": {
        retrieveFilesToCommit: async () => changes,
        copyToClipboard: async (text: string) => {
          clipboardText = text;
        },
      },
    })
  ).default;

  return {
    MainCommand,
    getCommittedMessage: () => committedMessage,
    getClipboardText: () => clipboardText,
  };
}

// ===========================================================================
// MainCommand: --yes (non-interactive) mode
// ===========================================================================

test("main --yes commits automatically without prompting", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    promptsResponses: {},
  });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "feat: test commit");
});

test("main --yes uses first available provider when multiple exist", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
  });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "feat: test commit");
});

// ===========================================================================
// MainCommand: no staged changes
// ===========================================================================

test("main exits early when no staged changes", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    changes: null,
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
});

// ===========================================================================
// MainCommand: no API keys configured
// ===========================================================================

test("main fails when no API keys are configured", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    allKeys: {},
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
});

// ===========================================================================
// MainCommand: explicit --provider flag
// ===========================================================================

test("main uses explicit provider when specified", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
    promptsResponses: { action: "commit" },
  });

  await MainCommand.action({ provider: "openai" });

  assert.equal(getCommittedMessage(), "feat: test commit");
});

test("main fails with invalid explicit provider", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    allKeys: { openai: "sk-key" },
  });

  await MainCommand.action({ provider: "invalid" });

  assert.equal(getCommittedMessage(), "");
});

// ===========================================================================
// MainCommand: AI generation error
// ===========================================================================

test("main stops when AI returns an error", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    aiResult: { error: "API rate limit exceeded" },
  });

  await MainCommand.action({ yes: true });

  assert.equal(getCommittedMessage(), "");
});

// ===========================================================================
// MainCommand: interactive action selection
// ===========================================================================

test("main commits when user selects commit action", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    promptsResponses: { value: "openai", action: "commit" },
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "feat: test commit");
});

test("main copies to clipboard when user selects copy action", async () => {
  const { MainCommand, getClipboardText } = await buildMainCommand({
    promptsResponses: { value: "openai", action: "copy" },
  });

  await MainCommand.action({});

  assert.equal(getClipboardText(), "feat: test commit");
});

test("main does nothing when user selects nothing action", async () => {
  const { MainCommand, getCommittedMessage, getClipboardText } =
    await buildMainCommand({
      promptsResponses: { value: "openai", action: "nothing" },
    });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
  assert.equal(getClipboardText(), "");
});

test("main exits when no action selected (prompt dismissed)", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    promptsResponses: { value: "openai" },
  });

  await MainCommand.action({});

  assert.equal(getCommittedMessage(), "");
});

// ===========================================================================
// MainCommand: commit failure fallback
// ===========================================================================

test("main copies message to clipboard when commit fails", async () => {
  const { MainCommand, getClipboardText } = await buildMainCommand({
    commitResult: false,
    promptsResponses: { value: "openai", action: "commit" },
  });

  await MainCommand.action({});

  assert.equal(getClipboardText(), "feat: test commit");
});

// ===========================================================================
// MainCommand: metadata
// ===========================================================================

test("main command has correct metadata", async () => {
  const { MainCommand } = await buildMainCommand({});

  assert.equal(MainCommand.name, "generate");
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--prompt")));
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--provider")));
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--yes")));
  assert.ok(MainCommand.options?.some((o) => o.flags.includes("--dry-run")));
});

// ===========================================================================
// MainCommand: --dry-run mode
// ===========================================================================

test("main --dry-run shows message without committing", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    promptsResponses: {},
  });

  await MainCommand.action({ dryRun: true, yes: true });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run exits before action prompt", async () => {
  const { MainCommand, getCommittedMessage, getClipboardText } =
    await buildMainCommand({
      promptsResponses: { value: "openai" },
    });

  await MainCommand.action({ dryRun: true });

  assert.equal(getCommittedMessage(), "");
  assert.equal(getClipboardText(), "");
});

test("main --dry-run works with --provider flag", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    allKeys: { openai: "sk-key", anthropic: "ak-key" },
  });

  await MainCommand.action({ dryRun: true, provider: "openai" });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run works with --prompt flag", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    promptsResponses: {},
  });

  await MainCommand.action({
    dryRun: true,
    prompt: "custom prompt",
    yes: true,
  });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run exits early when no staged changes", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    changes: null,
  });

  await MainCommand.action({ dryRun: true });

  assert.equal(getCommittedMessage(), "");
});

test("main --dry-run still fails when AI returns error", async () => {
  const { MainCommand, getCommittedMessage } = await buildMainCommand({
    aiResult: { error: "API rate limit exceeded" },
  });

  await MainCommand.action({ dryRun: true, yes: true });

  assert.equal(getCommittedMessage(), "");
});
