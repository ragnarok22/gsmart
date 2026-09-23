import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRequestFits,
  bytePrefix,
  estimateTokens,
  resolveContextBudget,
} from "../src/utils/context-budget.ts";

test("direct budget resolution rejects invalid totals, output allowances, and request limits", () => {
  for (const budgetTokens of [NaN, Infinity, 8192.5, 1023, 1_048_577]) {
    assert.throws(
      () => resolveContextBudget("custom", "local", { budgetTokens }),
      /context\.budgetTokens must be an integer from 1024 to 1048576/,
    );
  }
  for (const outputTokens of [NaN, Infinity, 1024.5, 255, 32_769]) {
    assert.throws(
      () => resolveContextBudget("custom", "local", { outputTokens }),
      /context\.outputTokens must be an integer from 256 to 32768/,
    );
  }
  for (const maxSummaryRequests of [NaN, Infinity, 1.5, 0, 65]) {
    assert.throws(
      () => resolveContextBudget("custom", "local", { maxSummaryRequests }),
      /context\.maxSummaryRequests must be an integer from 1 to 64/,
    );
  }
  assert.throws(
    () =>
      resolveContextBudget("custom", "local", {
        budgetTokens: 1024,
        outputTokens: 512,
      }),
    /leave room for input/,
  );
});

test("supported boundary limits preserve input room and the chosen output allowance", () => {
  for (const settings of [
    { budgetTokens: 1024, outputTokens: 256, maxSummaryRequests: 1 },
    { budgetTokens: 1_048_576, outputTokens: 32_768, maxSummaryRequests: 64 },
  ]) {
    const budget = resolveContextBudget("custom", "local", settings);
    assert.equal(budget.source, "override");
    assert.equal(budget.total, settings.budgetTokens);
    assert.equal(budget.output, settings.outputTokens);
    assert.ok(budget.input > 0);
    assert.equal(budget.input + budget.output + budget.overhead, budget.total);
  }
});

test("automatic model budgets enforce the cap while retaining model-specific fallback validation", () => {
  const budget = resolveContextBudget("openai", "gpt-4o", {
    outputTokens: 32_255,
  });
  assert.equal(budget.total, 32_768);
  assert.equal(budget.input, 1);
  assert.equal(budget.source, "model");
  assert.equal(budget.settings.budgetTokens, null);
  assert.throws(
    () => resolveContextBudget("openai", "gpt-4o", { outputTokens: 32_256 }),
    /leave room for input/,
  );
  assert.throws(
    () => resolveContextBudget("custom", "local", { outputTokens: 16_000 }),
    /leave room for input/,
  );
});

test("request accounting accepts an exact fit and rejects overflowing Unicode text", () => {
  const budget = resolveContextBudget("custom", "local");
  const system = "é".repeat(100);
  const prompt = "x".repeat(budget.input - estimateTokens(system));
  assert.doesNotThrow(() => assertRequestFits({ system, prompt }, budget));
  assert.throws(
    () => assertRequestFits({ system, prompt: prompt + "😀" }, budget),
    /Increase --context-budget or shorten instructions/,
  );
});

test("byte-limited text handles empty capacity and every Unicode boundary without replacement characters", () => {
  for (const [bytes, expected] of [
    [-1, ""],
    [0, ""],
    [1, ""],
    [2, ""],
    [3, "界"],
    [4, "界"],
    [5, "界"],
    [6, "界"],
    [7, "界😀"],
    [8, "界😀a"],
    [100, "界😀a"],
  ] as const) {
    const result = bytePrefix("界😀a", bytes);
    assert.equal(result, expected);
    assert.ok(estimateTokens(result) <= Math.max(0, bytes));
  }
});
