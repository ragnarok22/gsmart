import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import esmock from "esmock";
import { createMainCommand } from "../src/commands/main.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import { sourceDiff } from "../test-support/diff-fixtures.ts";
import { dispatchInterrupt } from "../src/utils/interrupt.ts";
import type { GenerationOptions, GenerationError } from "../src/utils/ai.ts";

async function setup({
  interactive = true,
  accept = true,
  model = "private-model",
  fileCount = 150,
  actions = ["commit"],
  confirm,
  transformResult,
}: {
  interactive?: boolean;
  accept?: unknown;
  model?: string;
  fileCount?: number;
  actions?: string[];
  confirm?: (index: number) => unknown;
  transformResult?: (
    result: string | GenerationError,
  ) => string | GenerationError;
} = {}) {
  const diff = Array.from({ length: fileCount }, (_, i) =>
    sourceDiff(`src/feature-${i}.ts`, 1),
  ).join("");
  const effective = resolveConventions();
  const messages: string[] = [];
  const questions: { type: unknown; message: unknown }[] = [];
  const generations: {
    diff: string;
    budget: number | null | undefined;
    refinement: GenerationOptions["refinement"];
  }[] = [];
  const commits: string[] = [];
  const requests: unknown[] = [];
  const exitCodes: number[] = [];
  let retrievals = 0;
  let snapshots = 0;
  let confirmations = 0;
  let actionIndex = 0;
  let spinning = false;
  const spinner = {
    text: "",
    start() {
      spinning = true;
      return this;
    },
    stop() {
      spinning = false;
      return this;
    },
    fail(message: string) {
      spinning = false;
      messages.push(stripVTControlCharacters(message));
      return this;
    },
    succeed(message: string) {
      spinning = false;
      messages.push(stripVTControlCharacters(message));
      return this;
    },
    info(message: string) {
      messages.push(stripVTControlCharacters(message));
      return this;
    },
    warn(message: string) {
      spinning = false;
      messages.push(stripVTControlCharacters(message));
      return this;
    },
  };
  const { AIBuilder } = await esmock<typeof import("../src/utils/ai.ts")>(
    "../src/utils/ai.ts",
    {
      "../src/utils/config.ts": {
        default: { getKey: () => "fake", getModel: () => model },
        validateApiKey: () => null,
      },
      ai: {
        generateText: async (request: unknown) => {
          requests.push(request);
          return {
            text:
              requests.length === 1
                ? "feat: update features"
                : "feat: refine features",
          };
        },
      },
    },
  );
  const command = createMainCommand({
    spinner: (() => spinner) as never,
    isInteractive: () => interactive,
    prompt: async (question) => {
      assert.ok(!Array.isArray(question));
      assert.equal(spinning, false, "stop the spinner before recovery prompts");
      questions.push({ type: question.type, message: question.message });
      if (question.name === "action") {
        assert.ok(
          actionIndex < actions.length,
          "unexpected extra candidate prompt",
        );
        return { action: actions[actionIndex++] };
      }
      if (question.name === "feedback")
        return { feedback: "Preserve 界😀 details." };
      assert.equal(question.type, "confirm");
      return {
        [String(question.name)]: confirm ? confirm(confirmations++) : accept,
      };
    },
    config: {
      getDefaultProvider: () => "openai",
      getModel: () => model,
      getKey: () => "fake",
      getPrompt: () => "",
      getOpenAIAuthMode: () => "api-key",
      getOpenAIOAuthTokens: () => null,
    } as never,
    getActiveProviders: () => [
      {
        title: "OpenAI",
        value: "openai",
        active: true,
        description: "fixture",
      },
    ],
    loadEffectiveConventions: async () => effective,
    retrieveFilesToCommit: async () => {
      retrievals++;
      return diff;
    },
    getGitBranch: async () => "main",
    getStagedSnapshot: async () => {
      snapshots++;
      return { branch: "main", diff, fingerprint: "same" };
    },
    AIBuilder: class extends AIBuilder {
      async generateCommitMessage(
        branch: string,
        changes: string,
        options?: GenerationOptions,
      ) {
        generations.push({
          diff: changes,
          budget: options?.conventions?.context.budgetTokens,
          refinement: options?.refinement,
        });
        const result = await super.generateCommitMessage(
          branch,
          changes,
          options,
        );
        return transformResult ? transformResult(result) : result;
      }
    },
    commitChanges: async (message) => {
      commits.push(message);
      return true;
    },
    log: (message) => messages.push(stripVTControlCharacters(String(message))),
    debugLog: () => {},
    debugTime: () => () => {},
    setExitCode: (code) => exitCodes.push(code),
  });
  return {
    command,
    messages,
    questions,
    generations,
    commits,
    requests,
    exitCodes,
    effective,
    retrievals: () => retrievals,
    snapshots: () => snapshots,
  };
}

for (const dryRun of [false, true]) {
  test(`metadata overflow offers a one-run budget increase and retries the captured diff (dryRun=${dryRun})`, async () => {
    const run = await setup();
    await run.command.action({ dryRun });
    assert.equal(
      run.questions[0]?.type,
      "confirm",
      "offer recovery before exiting",
    );
    assert.match(String(run.questions[0]?.message), /budget.*\d+.*retry/i);
    assert.equal(run.generations.length, 2);
    assert.equal(run.generations[0].diff, run.generations[1].diff);
    assert.ok(Number(run.generations[1].budget) > 8192);
    assert.equal(run.retrievals(), 1);
    assert.equal(run.snapshots(), dryRun ? 0 : 2);
    assert.equal(run.requests.length, 1);
    assert.deepEqual(run.exitCodes, []);
    assert.deepEqual(run.commits, dryRun ? [] : ["feat: update features"]);
    assert.equal(
      run.effective.conventions.context.budgetTokens,
      null,
      "recovery is invocation-local",
    );
  });
}

test("declining the budget increase stops without provider requests or commits", async () => {
  const run = await setup({ accept: false });
  await run.command.action({});
  assert.equal(run.questions.length, 1);
  assert.equal(run.generations.length, 1);
  assert.equal(run.requests.length, 0);
  assert.deepEqual(run.commits, []);
  assert.deepEqual(run.exitCodes, [1]);
});

for (const accept of [null, "true"]) {
  test(`initial recovery requires explicit true (answer=${String(accept)})`, async () => {
    const run = await setup({ accept });
    await run.command.action({});
    assert.equal(run.questions.length, 1);
    assert.equal(run.generations.length, 1);
    assert.equal(run.requests.length, 0);
    assert.deepEqual(run.commits, []);
    assert.deepEqual(run.exitCodes, [1]);
  });
}

test("known model limits suppress the interactive recovery offer", async () => {
  const run = await setup({ model: "gpt-4o", fileCount: 2600 });
  await run.command.action({});
  assert.deepEqual(run.questions, []);
  assert.equal(run.generations.length, 1);
  assert.equal(run.requests.length, 0);
  assert.deepEqual(run.commits, []);
  assert.deepEqual(run.exitCodes, [1]);
  assert.match(
    run.messages.join("\n"),
    /known context window \(128000 tokens\)/,
  );
  assert.doesNotMatch(run.messages.join("\n"), /--context-budget \d+/);
});

for (const accept of [false, undefined]) {
  test(`declining or canceling refinement recovery keeps the current candidate (answer=${String(accept)})`, async () => {
    const run = await setup({
      actions: ["regenerate", "commit"],
      confirm: (index) => (index === 0 ? true : accept),
    });
    await run.command.action({});
    assert.equal(run.questions.filter((q) => q.type === "confirm").length, 2);
    assert.equal(run.generations.length, 3);
    assert.equal(run.generations[1].budget, run.generations[2].budget);
    assert.equal(run.requests.length, 1);
    assert.deepEqual(run.commits, ["feat: update features"]);
    assert.deepEqual(run.exitCodes, []);
    assert.equal(run.effective.conventions.context.budgetTokens, null);
  });
}

test("approved refinement recovery preserves feedback and retains the session budget for later candidates", async () => {
  const run = await setup({ actions: ["regenerate", "regenerate", "commit"] });
  await run.command.action({});
  assert.equal(run.questions.filter((q) => q.type === "confirm").length, 2);
  assert.equal(run.generations.length, 5);
  assert.equal(run.requests.length, 3);
  assert.deepEqual(
    run.generations[2].refinement,
    run.generations[3].refinement,
  );
  assert.equal(
    run.generations[2].refinement?.feedback,
    "Preserve 界😀 details.",
  );
  assert.equal(run.generations[3].budget, run.generations[4].budget);
  assert.equal(
    run.generations[4].refinement?.previousMessage,
    "feat: refine features",
  );
  assert.ok(
    Number(run.generations[3].budget) > Number(run.generations[1].budget),
  );
  assert.ok(run.generations.every((g) => g.diff === run.generations[0].diff));
  assert.equal(run.retrievals(), 1);
  assert.equal(run.snapshots(), 2);
  assert.deepEqual(run.commits, ["feat: refine features"]);
  assert.deepEqual(run.exitCodes, []);
  assert.equal(run.effective.conventions.context.budgetTokens, null);
});

test("interrupting refinement recovery prevents retry even if the prompt returns true", async () => {
  const run = await setup({
    actions: ["regenerate", "commit"],
    confirm: (index) => {
      if (index === 1) assert.equal(dispatchInterrupt("SIGINT"), true);
      return true;
    },
  });
  await run.command.action({});
  assert.equal(run.generations.length, 3);
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.commits, ["feat: update features"]);
  assert.deepEqual(run.exitCodes, []);
  assert.match(
    run.messages.join("\n"),
    /Generation canceled\. Current candidate kept/,
  );
});

test("a repeated metadata failure stops after one approved retry", async () => {
  let initialError: GenerationError;
  const run = await setup({
    transformResult: (result) => {
      if (typeof result !== "string") {
        assert.ok(result.contextRecovery);
        initialError = result;
        return result;
      }
      const recovery = initialError.contextRecovery!;
      // Even a new, larger suggestion must not cause a retry loop.
      return {
        ...initialError,
        contextRecovery: {
          ...recovery,
          currentBudgetTokens: recovery.requiredBudgetTokens,
          requiredBudgetTokens: recovery.requiredBudgetTokens + 100,
          suggestedBudgetTokens: recovery.requiredBudgetTokens + 100,
        },
      };
    },
  });
  await run.command.action({});
  assert.equal(run.questions.length, 1);
  assert.equal(run.generations.length, 2);
  assert.deepEqual(run.commits, []);
  assert.deepEqual(run.exitCodes, [1]);
});

for (const [interactive, yes] of [
  [true, true],
  [false, false],
] as const) {
  test(`automation gets a concrete retry command without prompting (interactive=${interactive}, yes=${yes})`, async () => {
    const run = await setup({ interactive });
    await run.command.action({ yes, dryRun: true });
    assert.deepEqual(run.questions, []);
    assert.equal(run.generations.length, 1);
    assert.equal(run.requests.length, 0);
    assert.deepEqual(run.commits, []);
    assert.deepEqual(run.exitCodes, [1]);
    assert.match(run.messages.join("\n"), /--context-budget \d+/);
  });
}
