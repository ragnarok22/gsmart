import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import { createMainCommand } from "../src/commands/main.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import type { ContextSettings } from "../src/definitions.ts";

function setup({
  result = "feat: fixture",
  commitResult = true,
  commitError,
  copyResult = true,
  configured = true,
  context = {},
  model = "private-model",
}: {
  result?: string | { error: string } | Error;
  commitResult?: boolean;
  commitError?: Error;
  copyResult?: boolean;
  configured?: boolean;
  context?: ContextSettings;
  model?: string;
} = {}) {
  let exitCode = 0;
  let retrievals = 0;
  const messages: string[] = [];
  const copied: string[] = [];
  const committed: string[] = [];
  const logs: string[] = [];
  const spinner = {
    text: "",
    start() {
      return this;
    },
    stop() {
      return this;
    },
    fail(message: string) {
      messages.push(message);
      return this;
    },
    succeed(message: string) {
      messages.push(message);
      return this;
    },
    warn(message: string) {
      messages.push(message);
      return this;
    },
    info(message: string) {
      messages.push(message);
      return this;
    },
  };
  const command = createMainCommand({
    spinner: (() => spinner) as never,
    prompt: async () => ({ action: "commit" }),
    config: {
      getDefaultProvider: () => undefined,
      getModel: () => model,
      getKey: () => (configured ? "sk-ant-test" : ""),
      getPrompt: () => "",
    } as never,
    getActiveProviders: () => [
      {
        title: "Anthropic",
        value: "anthropic",
        active: true,
        description: "fixture",
      },
    ],
    loadEffectiveConventions: async () =>
      resolveConventions([{ source: "fixture", settings: { context } }]),
    retrieveFilesToCommit: async () => {
      retrievals++;
      return "+fixture";
    },
    getGitBranch: async () => "main",
    getStagedSnapshot: async () => ({
      branch: "main",
      diff: "+fixture",
      fingerprint: "same",
    }),
    AIBuilder: class {
      async generateCommitMessage() {
        if (result instanceof Error) throw result;
        return result;
      }
    },
    commitChanges: async (message, onError?: (error: Error) => void) => {
      committed.push(message);
      if (commitError) onError?.(commitError);
      return commitResult;
    },
    copyToClipboard: async (message) => {
      copied.push(message);
      return copyResult;
    },
    log: (message) => logs.push(message),
    setExitCode: (code) => {
      exitCode = code;
    },
  });
  return {
    command,
    messages,
    copied,
    committed,
    logs,
    exitCode: () => exitCode,
    retrievals: () => retrievals,
  };
}

test("failed automatic commit sets a failure exit code", async () => {
  const run = setup({ commitResult: false });
  await run.command.action({ yes: true });
  assert.ok(
    run.messages.some((message) => message.includes("Failed to commit")),
  );
  assert.equal(run.exitCode(), 1);
});

for (const options of [{ yes: true }, {}, { dryRun: true, yes: true }]) {
  for (const result of [
    " ",
    new Error("generation failed"),
    { error: "generation rejected" },
  ]) {
    test(`initial generation failure sets a failure exit code: ${String(result)} (${JSON.stringify(options)})`, async () => {
      const run = setup({ result });
      await run.command.action(options);
      assert.equal(run.exitCode(), 1);
      assert.deepEqual(run.committed, []);
      assert.deepEqual(run.copied, []);
    });
  }
}

for (const yes of [false, true]) {
  for (const copyResult of [false, true]) {
    test(`commit failure reports Git diagnostics and preserves the message (yes=${yes}, clipboard=${copyResult})`, async () => {
      const detail = "pre-commit hook rejected the commit: lint failed";
      const run = setup({
        commitResult: false,
        commitError: new Error(detail),
        copyResult,
      });
      await run.command.action({ yes });
      assert.equal(run.exitCode(), 1);
      assert.deepEqual(run.committed, ["feat: fixture"]);
      assert.deepEqual(run.copied, ["feat: fixture"]);
      assert.ok(
        run.messages.some(
          (message) =>
            message.includes("Failed to commit") && message.includes(detail),
        ),
      );
      if (!copyResult) assert.equal(run.logs.at(-1), "feat: fixture");
    });
  }
}

test("missing providers fail before auto-staging", async () => {
  const run = setup({ configured: false });
  await run.command.action({ yes: true });
  assert.equal(run.exitCode(), 1);
  assert.equal(run.retrievals(), 0);
  assert.ok(
    run.messages.some((message) => message.includes("No configured providers")),
  );
});

test("the selected model's implicit budget is checked before auto-staging", async () => {
  const run = setup({ context: { outputTokens: 8192 } });
  await run.command.action({ yes: true });
  assert.equal(run.exitCode(), 1);
  assert.equal(run.retrievals(), 0);
  assert.ok(
    run.messages.some((message) => message.includes("leave room for input")),
  );
});
