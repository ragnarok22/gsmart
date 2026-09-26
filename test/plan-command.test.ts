import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import { createPlanCommand } from "../src/commands/plan.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import { dispatchInterrupt } from "../src/utils/interrupt.ts";
import type { StagedSnapshot } from "../src/utils/git.ts";
import { featureDiff } from "../test-support/split-plan-fixtures.ts";

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
