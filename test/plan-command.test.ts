import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import { createPlanCommand } from "../src/commands/plan.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import { dispatchInterrupt } from "../src/utils/interrupt.ts";
import type { StagedSnapshot } from "../src/utils/git.ts";
import { commit, featureDiff } from "../test-support/split-plan-fixtures.ts";
import { inventoryChanges } from "../src/utils/split-plan.ts";
import type { GenerationOptions } from "../src/utils/ai.ts";

const snapshot: StagedSnapshot = {
  branch: "main",
  diff: featureDiff,
  fingerprint: "captured-staged-snapshot",
};

function localPlan(overrides: Parameters<typeof createPlanCommand>[0] = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const captures: (StagedSnapshot | undefined)[] = [];
  const providerAccess = () =>
    assert.fail("Local plans must not access provider configuration or AI");
  const command = createPlanCommand({
    config: {
      getPrompt: () => "",
      getDefaultProvider: providerAccess,
      getModel: providerAccess,
      getKey: providerAccess,
      getCustomBaseURL: providerAccess,
    } as never,
    getActiveProviders: providerAccess,
    getRecentCommitSubjects: async () =>
      assert.fail("Local plans must not load AI history examples"),
    AIBuilder: class {
      constructor() {
        providerAccess();
      }
      async generateCommitPlan(): Promise<never> {
        return providerAccess();
      }
    },
    loadEffectiveConventions: async () => ({
      ...resolveConventions([
        {
          source: "repository",
          settings: {
            context: { exclude: ["src/**"] },
            history: { enabled: true, limit: 5 },
          },
        },
      ]),
      root: "/fixture/repository",
    }),
    getStagedSnapshot: async (previous) => {
      captures.push(previous);
      return snapshot;
    },
    output: (value) => {
      stdout.push(value);
    },
    diagnostic: (value) => {
      stderr.push(value);
    },
    setExitCode: (value) => {
      exitCodes.push(value);
    },
    ...overrides,
  });
  return { command, stdout, stderr, exitCodes, captures };
}

test("local-only plans skip provider/model/auth/history access and revalidate the captured snapshot", async () => {
  const app = localPlan();
  await app.command.action({ staged: true, provider: "custom" });
  assert.deepEqual(app.exitCodes, [0]);
  assert.deepEqual(app.stderr, []);
  assert.equal(app.stdout.length, 1);
  assert.match(app.stdout[0], /Manual review.*excluded from AI context/);
  assert.match(app.stdout[0], /"src\/retry.ts"/);
  assert.deepEqual(app.captures, [undefined, snapshot]);
});

test("local-only plans reject a stale staged snapshot before rendering", async () => {
  const app = localPlan({
    getStagedSnapshot: async (previous) =>
      previous ? { ...snapshot, fingerprint: "externally-changed" } : snapshot,
  });
  await app.command.action({ staged: true });
  assert.deepEqual(app.exitCodes, [1]);
  assert.deepEqual(app.stdout, []);
  assert.match(app.stderr.join("\n"), /changed during planning/);
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`${signal} during local-plan verification cancels without rendering`, async () => {
    const app = localPlan({
      getStagedSnapshot: async (previous) => {
        if (previous) assert.equal(dispatchInterrupt(signal), true);
        return snapshot;
      },
    });
    await app.command.action({ staged: true });
    assert.deepEqual(app.exitCodes, [code]);
    assert.deepEqual(app.stdout, []);
    assert.match(
      app.stderr.join("\n"),
      new RegExp(`Planning canceled by ${signal}`),
    );
    assert.equal(
      dispatchInterrupt(signal),
      false,
      "interrupt handler was removed",
    );
  });
}

test("local-only planning still rejects syntactically invalid provider flags before reading Git", async () => {
  const app = localPlan();
  await app.command.action({ staged: true, provider: "not-a-provider" });
  assert.deepEqual(app.exitCodes, [2]);
  assert.deepEqual(app.stdout, []);
  assert.deepEqual(app.captures, []);
  assert.match(app.stderr.join("\n"), /provider/i);
});

test("AI-backed planning rejects a selected provider without credentials", async () => {
  const app = localPlan({
    config: {
      getPrompt: () => "",
      getModel: () => "",
      getKey: () => "",
    } as never,
    loadEffectiveConventions: async () => resolveConventions(),
  });
  await app.command.action({ staged: true, provider: "anthropic" });
  assert.deepEqual(app.exitCodes, [1]);
  assert.deepEqual(app.stdout, []);
  assert.match(app.stderr.join("\n"), /Provider anthropic is not configured/);
});

test("provider fallback preserves saved instructions and sends configuration diagnostics separately", async () => {
  const selected: { provider: string; prompt: string }[] = [];
  const requests: GenerationOptions[] = [];
  const app = localPlan({
    config: {
      getPrompt: () => "Prefer concise behavioral descriptions.",
      getDefaultProvider: () => undefined,
      getModel: () => "saved-model",
      getKey: (provider: string) =>
        provider === "anthropic" ? "test-key" : "",
      getOpenAIAuthMode: () => "api-key",
      getOpenAIOAuthTokens: () => null,
    } as never,
    getActiveProviders: () => [
      { value: "openai", title: "OpenAI", active: true, description: "" },
      { value: "anthropic", title: "Anthropic", active: true, description: "" },
    ],
    loadEffectiveConventions: async ({ user = {}, cli = {} } = {}) => ({
      ...resolveConventions([
        { source: "user", settings: user },
        { source: "CLI", settings: cli },
      ]),
      diagnostics: ["Ignored unsupported commitlint rule: subject-case"],
    }),
    AIBuilder: class {
      constructor(provider: string, prompt: string) {
        selected.push({ provider, prompt });
      }
      async generateCommitPlan(
        branch: string,
        diff: string,
        options?: GenerationOptions,
      ) {
        assert.equal(branch, snapshot.branch);
        assert.equal(diff, featureDiff);
        assert.ok(options);
        requests.push(options);
        return {
          changes: inventoryChanges(diff),
          commits: [commit("retry", ["f1.h1"])],
        };
      }
    },
  });
  await app.command.action({ staged: true });
  assert.deepEqual(app.exitCodes, [0]);
  assert.deepEqual(selected, [
    {
      provider: "anthropic",
      prompt: "Prefer concise behavioral descriptions.",
    },
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "saved-model");
  assert.equal(requests[0].conventions?.instructions, selected[0].prompt);
  assert.deepEqual(app.stderr, [
    "Ignored unsupported commitlint rule: subject-case",
  ]);
  assert.equal(app.stdout.length, 1);
  assert.doesNotMatch(app.stdout[0], /unsupported commitlint/);
  assert.deepEqual(app.captures, [undefined, snapshot]);
});

test("ChatGPT OAuth planning chooses the subscription model without an API key", async () => {
  let selectedModel: string | undefined;
  const app = localPlan({
    config: {
      getPrompt: () => "",
      getDefaultProvider: () => "openai",
      getModel: () => "",
      getKey: () => "",
      getOpenAIAuthMode: () => "oauth",
      getOpenAIOAuthTokens: () => ({ accessToken: "fixture-oauth-token" }),
    } as never,
    loadEffectiveConventions: async () => resolveConventions(),
    AIBuilder: class {
      constructor(provider: string) {
        assert.equal(provider, "openai");
      }
      async generateCommitPlan(
        _branch: string,
        diff: string,
        options?: GenerationOptions,
      ) {
        selectedModel = options?.model;
        return {
          changes: inventoryChanges(diff),
          commits: [commit("retry", ["f1.h1"])],
        };
      }
    },
  });
  await app.command.action({ staged: true });
  assert.deepEqual(app.exitCodes, [0]);
  assert.equal(selectedModel, "gpt-5-codex");
  assert.equal(app.stdout.length, 1);
  assert.deepEqual(app.stderr, []);
});

test("an unclassified generation failure keeps its diagnostic and never displays a partial plan", async () => {
  const app = localPlan({
    config: {
      getPrompt: () => "",
      getDefaultProvider: () => "anthropic",
      getModel: () => "saved-model",
      getKey: () => "test-key",
    } as never,
    loadEffectiveConventions: async () => resolveConventions(),
    AIBuilder: class {
      async generateCommitPlan() {
        return { error: "Provider stopped before producing a plan." };
      }
    },
  });
  await app.command.action({ staged: true });
  assert.deepEqual(app.exitCodes, [1]);
  assert.deepEqual(app.stdout, []);
  assert.deepEqual(app.stderr, [
    "error: Provider stopped before producing a plan.",
  ]);
  assert.deepEqual(app.captures, [undefined]);
});
