import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import esmock from "esmock";
import { sourceDiff, lockfileDiff } from "../test-support/diff-fixtures.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import {
  estimateTokens,
  REQUEST_OVERHEAD,
} from "../src/utils/context-budget.ts";
import type { ContextReport } from "../src/utils/diff-context.ts";
import type { ContextSettings } from "../src/definitions.ts";

type Request = { system: string; prompt: string; maxOutputTokens: number };
const conventions = (context: ContextSettings = {}) =>
  resolveConventions([{ source: "test", settings: { context } }]).conventions;

async function builder(
  reply: (
    request: Request,
  ) => Promise<{ text: string; finishReason?: string }> = async () => ({
    text: "feat: retry requests",
  }),
) {
  const requests: Request[] = [];
  const { AIBuilder } = await esmock<typeof import("../src/utils/ai.ts")>(
    "../src/utils/ai.ts",
    {
      "../src/utils/config.ts": {
        default: { getKey: () => "fake", getModel: () => "" },
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
  return { ai: new AIBuilder("openai", ""), requests };
}

test("large requests are reduced locally by default and include all instruction overhead", async () => {
  const { ai, requests } = await builder();
  let report: ContextReport | undefined;
  const c = conventions();
  c.instructions = "Use imperative mood.";
  c.history.enabled = true;
  assert.equal(
    await ai.generateCommitMessage(
      "feature/retry",
      sourceDiff() + lockfileDiff(),
      {
        conventions: c,
        historyExamples: ["fix(api): preserve response bodies"],
        refinement: {
          previousMessage: "fix: handle requests",
          feedback: "Mention retries",
        },
        onContextPrepared: (value) => {
          report = value;
        },
      },
    ),
    "feat: retry requests",
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].prompt, /Use imperative mood/);
  assert.match(requests[0].prompt, /Mention retries/);
  assert.match(requests[0].prompt, /library-\d+@2.0.0/);
  assert.match(requests[0].prompt, /attempts: 3/);
  assert.ok(report);
  assert.equal(report.summaryRequests, 0);
  assert.ok(
    estimateTokens(requests[0].prompt) +
      estimateTokens(requests[0].system) +
      REQUEST_OVERHEAD +
      requests[0].maxOutputTokens <=
      report.budgetTokens,
  );
});

test("opt-in summarization budgets every request and reports partial coverage", async () => {
  const { ai, requests } = await builder(async (request) => ({
    text: request.system.startsWith("Summarize")
      ? "Handlers now retry fetches up to three times."
      : "fix(api): retry handler requests",
  }));
  let report: ContextReport | undefined;
  const result = await ai.generateCommitMessage("main", sourceDiff(), {
    conventions: conventions({ summarize: true, maxSummaryRequests: 2 }),
    onContextPrepared: (value) => {
      report = value;
    },
  });
  assert.equal(result, "fix(api): retry handler requests");
  assert.equal(requests.length, 3);
  assert.equal(report?.summaryRequests, 2);
  assert.equal(report?.files[0].partial, true);
  for (const request of requests) {
    assert.ok(
      estimateTokens(request.system) +
        estimateTokens(request.prompt) +
        request.maxOutputTokens +
        REQUEST_OVERHEAD <=
        8192,
    );
    assert.ok(
      !request.prompt.includes("\ufffd"),
      "chunks must not split Unicode code points",
    );
  }
  assert.match(requests[2].prompt, /Handlers now retry/);
});

test("failed, empty and truncated summaries prevent final generation", async () => {
  for (const reply of [
    async () => {
      throw new Error("summary unavailable");
    },
    async () => ({ text: "" }),
    async () => ({ text: "Partial response", finishReason: "length" }),
  ]) {
    const { ai, requests } = await builder(reply);
    const result = await ai.generateCommitMessage("main", sourceDiff(), {
      conventions: conventions({ summarize: true }),
    });
    assert.ok(typeof result === "object");
    assert.match(result.error, /summary|summarization/i);
    assert.equal(requests.length, 1);
  }
});

test("summary attempts include retries and cancellation stops the pipeline", async () => {
  const { ai, requests } = await builder(async () => {
    throw new Error("network failure");
  });
  const result = await ai.generateCommitMessage("main", sourceDiff(), {
    conventions: conventions({ summarize: true, maxSummaryRequests: 2 }),
    delayFn: async () => {},
  });
  assert.ok(typeof result === "object");
  assert.match(result.error, /request limit.*retries/);
  assert.equal(requests.length, 2);

  const controller = new AbortController();
  const canceled = await builder(async () => {
    controller.abort();
    return { text: "summary" };
  });
  assert.deepEqual(
    await canceled.ai.generateCommitMessage("main", sourceDiff(), {
      conventions: conventions({ summarize: true }),
      abortSignal: controller.signal,
    }),
    { error: "Generation canceled." },
  );
  assert.equal(canceled.requests.length, 1);
});

test("empty, excluded and instruction-only oversized requests do not call the provider", async () => {
  const { ai, requests } = await builder();
  for (const [diff, settings] of [
    ["", conventions()],
    [sourceDiff(), conventions({ exclude: ["**"] })],
    [sourceDiff(), { ...conventions(), instructions: "界".repeat(10000) }],
  ] as const) {
    const result = await ai.generateCommitMessage("main", diff, {
      conventions: settings,
    });
    assert.ok(typeof result === "object");
    assert.match(result.error, /context/i);
  }
  assert.equal(requests.length, 0);
});

test("context report failures are returned clearly before sending the final request", async () => {
  for (const failure of [
    new Error("context report output failed"),
    "context report output failed",
  ]) {
    const { ai, requests } = await builder();
    const result = await ai.generateCommitMessage(
      "main",
      sourceDiff("small.ts", 1),
      {
        onContextPrepared: () => {
          throw failure;
        },
      },
    );
    assert.deepEqual(result, {
      error: "Context preparation failed: context report output failed",
    });
    assert.equal(requests.length, 0);
  }
});
