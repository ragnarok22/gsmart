import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import esmock from "esmock";
import { resolveConventions } from "../src/utils/conventions.ts";
import type { ContextSettings } from "../src/definitions.ts";
import type { ContextReport } from "../src/utils/diff-context.ts";
import {
  estimateTokens,
  REQUEST_OVERHEAD,
} from "../src/utils/context-budget.ts";
import { sourceDiff } from "../test-support/diff-fixtures.ts";
import {
  commit,
  featureDiff,
  mixedCommits,
  mixedDiff,
} from "../test-support/split-plan-fixtures.ts";
import { renderSplitPlan } from "../src/utils/split-plan.ts";

type Request = {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
};
async function setup(
  reply: (request: Request) => Promise<{ text: string; finishReason?: string }>,
  configOverrides: { getKey?: () => string } = {},
) {
  const requests: Request[] = [];
  const { AIBuilder } = await esmock<typeof import("../src/utils/ai.ts")>(
    "../src/utils/ai.ts",
    {
      "../src/utils/config.ts": {
        default: {
          getKey: () => "fake",
          getModel: () => "",
          ...configOverrides,
        },
        validateApiKey: () => null,
      },
      ai: {
        generateText: async (request: Request) => {
          requests.push(request);
          return reply(request);
        },
      },
    },
  );
  return { ai: new AIBuilder("openai", "Keep it concise."), requests };
}
const conventions = (context: ContextSettings = {}) =>
  resolveConventions([{ source: "test", settings: { context } }]).conventions;

test("AI planning uses the shared provider pipeline and validates mixed/coherent responses", async () => {
  for (const [diff, commits] of [
    [mixedDiff, mixedCommits],
    [featureDiff, [commit("one", ["f1.h1"])]],
  ] as const) {
    const app = await setup(async () => ({
      text: JSON.stringify({ commits }),
    }));
    const plan = await app.ai.generateCommitPlan("feature/498", diff);
    assert.ok(!("error" in plan), JSON.stringify(plan));
    assert.equal(plan.commits.length, commits.length);
    assert.equal(app.requests.length, 1);
    assert.match(app.requests[0].prompt, /Keep it concise/);
    assert.match(app.requests[0].prompt, /feature\/498/);
    assert.ok(plan.context);
    assert.ok(
      estimateTokens(app.requests[0].system) +
        estimateTokens(app.requests[0].prompt) +
        app.requests[0].maxOutputTokens +
        REQUEST_OVERHEAD <=
        plan.context.budgetTokens,
    );
  }
});

test("plan accounting survives reduced/summarized context and reduction is visible in the review", async () => {
  for (const summarize of [false, true]) {
    // One large hunk keeps inventory small while requiring context reduction.
    const diff = featureDiff + "+detail\n".repeat(4000);
    const app = await setup(async (request) => ({
      text: request.system.startsWith("Summarize")
        ? "Retry attempts changed."
        : JSON.stringify({ commits: [commit("one", ["f1.h1"])] }),
    }));
    const plan = await app.ai.generateCommitPlan("main", diff, {
      conventions: conventions({ summarize, maxSummaryRequests: 1 }),
    });
    assert.ok(!("error" in plan), JSON.stringify(plan));
    assert.match(app.requests.at(-1)!.prompt, /"id":"f1.h1"/);
    assert.equal(
      plan.context?.files[0].treatment,
      summarize ? "summarized" : "condensed",
    );
    assert.equal(app.requests.length, summarize ? 2 : 1);
    assert.match(renderSplitPlan(plan), /AI context was reduced/);
    for (const request of app.requests)
      assert.ok(
        estimateTokens(request.system) +
          estimateTokens(request.prompt) +
          request.maxOutputTokens +
          REQUEST_OVERHEAD <=
          8192,
      );
  }
});

test("excluded changes never leak into final or summary requests and remain accounted for locally", async () => {
  const privateDiff = featureDiff
    .replaceAll("src/retry.ts", "secret/private.ts")
    .replaceAll("attempts", "privateSymbol");
  const app = await setup(async (request) => ({
    text: request.system.startsWith("Summarize")
      ? "Public retry change."
      : JSON.stringify({ commits: [commit("one", ["f1.h1"])] }),
  }));
  const plan = await app.ai.generateCommitPlan(
    "main",
    featureDiff + "+detail\n".repeat(4000) + privateDiff,
    {
      conventions: conventions({
        exclude: ["secret/**"],
        summarize: true,
        maxSummaryRequests: 1,
      }),
    },
  );
  assert.ok(!("error" in plan), JSON.stringify(plan));
  assert.equal(app.requests.length, 2);
  assert.doesNotMatch(
    JSON.stringify(app.requests),
    /private.ts|privateSymbol|f2/,
  );
  assert.match(renderSplitPlan(plan), /secret\/private.ts/);
  assert.equal(plan.changes.filter((change) => change.excluded).length, 1);
});

test("all-excluded scope is a local manual-review result and empty scope fails without requests", async () => {
  const app = await setup(async () => {
    throw new Error("must not request");
  });
  const plan = await app.ai.generateCommitPlan("main", mixedDiff, {
    conventions: conventions({ exclude: ["**"] }),
  });
  assert.ok(!("error" in plan));
  assert.equal(plan.commits.length, 0);
  assert.equal(plan.changes.length, 3);
  assert.equal(
    ((await app.ai.generateCommitPlan("main", "")) as { code: string }).code,
    "NO_INPUT",
  );
  assert.equal(app.requests.length, 0);
});

test("invalid, empty, incomplete, excluded-ID and truncated provider responses are errors", async () => {
  for (const response of [
    { text: "" },
    { text: "Here is a plan" },
    { text: JSON.stringify({ commits: [commit("one", ["f1.h1"])] }) },
    { text: JSON.stringify({ commits: mixedCommits }), finishReason: "length" },
  ]) {
    const app = await setup(async () => response);
    const result = await app.ai.generateCommitPlan("main", mixedDiff);
    assert.ok("error" in result, JSON.stringify(result));
    assert.equal(result.code, "GENERATION");
  }
  const app = await setup(async () => ({
    text: JSON.stringify({ commits: mixedCommits }),
  }));
  const result = await app.ai.generateCommitPlan("main", mixedDiff, {
    conventions: conventions({ exclude: ["src/**"] }),
  });
  assert.ok("error" in result);
  assert.match(result.error, /unknown or excluded change/);
});

test("an oversized inventory fails before calling the provider rather than losing units", async () => {
  const app = await setup(async () => {
    throw new Error("must not request");
  });
  const result = await app.ai.generateCommitPlan(
    "main",
    sourceDiff("many-hunks.ts", 500),
  );
  assert.ok("error" in result);
  assert.equal(result.code, "CONTEXT");
  assert.match(result.error, /context budget/);
  assert.equal(app.requests.length, 0);
});

test("planning retains retries and honors cancellation", async () => {
  let attempts = 0;
  const app = await setup(async () => {
    if (++attempts === 1) throw new Error("network failure");
    return { text: JSON.stringify({ commits: [commit("one", ["f1.h1"])] }) };
  });
  assert.ok(
    !(
      "error" in
      (await app.ai.generateCommitPlan("main", featureDiff, {
        delayFn: async () => {},
      }))
    ),
  );
  assert.equal(attempts, 2);
  const controller = new AbortController();
  const canceled = await setup(async (request) => {
    assert.equal(request.abortSignal, controller.signal);
    controller.abort();
    return { text: "late response" };
  });
  const result = await canceled.ai.generateCommitPlan("main", featureDiff, {
    abortSignal: controller.signal,
  });
  assert.ok("error" in result);
  assert.match(result.error, /canceled/i);
  const before = await canceled.ai.generateCommitPlan("main", featureDiff, {
    abortSignal: controller.signal,
  });
  assert.ok("error" in before);
  assert.equal(before.code, "CANCELED");
  assert.equal(canceled.requests.length, 1);
});

test("planning delivers the context report before generation and retains it on the validated plan", async () => {
  const reports: ContextReport[] = [];
  const app = await setup(async () => {
    assert.equal(
      reports.length,
      1,
      "context should be available before the request",
    );
    return { text: JSON.stringify({ commits: [commit("retry", ["f1.h1"])] }) };
  });
  const plan = await app.ai.generateCommitPlan("main", featureDiff, {
    onContextPrepared: (report) => {
      reports.push(report);
    },
  });
  assert.ok(!("error" in plan), JSON.stringify(plan));
  assert.equal(plan.context, reports[0]);
  assert.equal(reports[0].files[0].path, "src/retry.ts");
  assert.equal(reports[0].files[0].treatment, "full");
  assert.equal(app.requests.length, 1);
});

test("a planning context callback failure is actionable and stops the provider request", async () => {
  const app = await setup(async () =>
    assert.fail("must not generate after a failed context callback"),
  );
  const result = await app.ai.generateCommitPlan("main", featureDiff, {
    onContextPrepared: () => {
      throw new Error("context report could not be written");
    },
  });
  assert.ok("error" in result);
  assert.equal(result.code, "CONTEXT");
  assert.match(result.error, /context report could not be written/);
  assert.equal(app.requests.length, 0);
});

test("planning reports unexpected credential-store failures, including non-Error rejections", async () => {
  for (const cause of [
    new Error("credential store unavailable"),
    "credential store unavailable",
  ]) {
    const app = await setup(
      async () => assert.fail("must not request without credentials"),
      {
        getKey: () => {
          throw cause;
        },
      },
    );
    const result = await app.ai.generateCommitPlan("main", featureDiff);
    assert.deepEqual(result, {
      error: "Could not generate a valid plan: credential store unavailable",
      code: "GENERATION",
    });
    assert.equal(app.requests.length, 0);
  }
});
