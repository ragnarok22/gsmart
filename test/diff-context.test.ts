import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareContext,
  parseDiffFiles,
  matchesContextPattern,
} from "../src/utils/diff-context.ts";
import {
  resolveContextBudget,
  estimateTokens,
  bytePrefix,
} from "../src/utils/context-budget.ts";
import {
  resolveConventions,
  conventionsFromOptions,
} from "../src/utils/conventions.ts";

const patch = (path: string, lines = 1) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,${lines} @@ function change()\n-old behavior\n${Array.from({ length: lines }, (_, i) => `+export const value${i} = "new behavior 界😀";`).join("\n")}\n`;
const buildPrompt = (changes: string) => ({
  system: "Follow commit conventions.",
  prompt: `Changes:\n${changes}\nReturn a commit message.`,
});

test("small diffs retain the exact full-context path, including lockfiles", async () => {
  const diff = patch("src/main.ts") + patch("pnpm-lock.yaml");
  const result = await prepareContext({
    diff,
    budget: resolveContextBudget("custom", "local"),
    buildPrompt,
  });
  assert.equal(result.prompt, buildPrompt(diff).prompt);
  assert.ok(result.report.files.every((file) => file.treatment === "full"));
});

test("large generated, lockfile and source changes fit and retain meaningful metadata", async () => {
  const diff =
    patch("pnpm-lock.yaml", 2000) +
    patch("src/main.ts", 50000) +
    patch("dist/index.js", 1000) +
    patch("small.ts");
  const budget = resolveContextBudget("custom", "local");
  const result = await prepareContext({ diff, budget, buildPrompt });
  assert.ok(estimateTokens(diff) > 1024 * 1024);
  assert.ok(
    result.report.inputTokens + budget.output + budget.overhead <= budget.total,
  );
  assert.match(result.prompt, /small.ts/);
  assert.match(result.prompt, /new behavior/);
  assert.match(result.prompt, /\+50000 -1/);
  assert.equal(result.report.files[0].kind, "lockfile");
  assert.equal(result.report.files[2].kind, "generated");
  assert.equal(result.report.summaryRequests, 0);
});

test("exclusions omit entire patches, match both rename paths, and fail when empty", async () => {
  const diff = patch("private/key.ts") + patch("public.ts");
  const result = await prepareContext({
    diff,
    budget: resolveContextBudget("custom", "x", { exclude: ["private/**"] }),
    buildPrompt,
  });
  assert.doesNotMatch(result.prompt, /private/);
  assert.equal(result.report.files[0].treatment, "excluded");
  await assert.rejects(
    prepareContext({
      diff,
      budget: resolveContextBudget("custom", "x", { exclude: ["**"] }),
      buildPrompt,
    }),
    /No usable AI context/,
  );
  await assert.rejects(
    prepareContext({
      diff: "",
      budget: resolveContextBudget("custom", "x"),
      buildPrompt,
    }),
    /No usable AI context/,
  );
});

test("budgets count instructions and Unicode, with conservative unknown model fallback", async () => {
  assert.equal(resolveContextBudget("custom", "gpt-4o").total, 8192);
  assert.equal(resolveContextBudget("openai", "gpt-4o").source, "model");
  assert.equal(
    resolveContextBudget("openai", "new-private-model").source,
    "fallback",
  );
  assert.equal(
    resolveContextBudget("custom", "local", { budgetTokens: 16000 }).source,
    "override",
  );
  assert.equal(estimateTokens("界😀"), 7);
  assert.equal(bytePrefix("界😀", 6), "界");
  assert.throws(
    () => resolveContextBudget("openai", "gpt-4o", { budgetTokens: 200000 }),
    /known/,
  );
  assert.throws(
    () => resolveContextBudget("custom", "x", { budgetTokens: 1024 }),
    /leave room/,
  );
  await assert.rejects(
    prepareContext({
      diff: patch("x.ts"),
      budget: resolveContextBudget("custom", "x"),
      buildPrompt: (text) => ({ system: "界".repeat(5000), prompt: text }),
    }),
    /exceeds the context budget/,
  );
});

test("binary, rename, deletion and quoted UTF-8 paths remain useful", () => {
  const diff = `diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\ndiff --git a/image.png b/image.png\nnew file mode 100644\nBinary files /dev/null and b/image.png differ\ndiff --git "a/\\303\\251.txt" "b/\\303\\251.txt"\ndeleted file mode 100644\n--- "a/\\303\\251.txt"\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted text\n`;
  const files = parseDiffFiles(diff);
  assert.equal(files[0].originalPath, "old.txt");
  assert.equal(files[0].path, "new.txt");
  assert.match(files[1].metadata, /added.*binary/);
  assert.equal(files[2].path, "é.txt");
  assert.match(files[2].metadata, /deleted; \+0 -1/);
});

test("summary requests and final composition fit; failures do not yield a message", async () => {
  const budget = resolveContextBudget("custom", "local", {
    summarize: true,
    maxSummaryRequests: 3,
  });
  let calls = 0;
  const result = await prepareContext({
    diff: patch("src/huge.ts", 10000),
    budget,
    buildPrompt,
    summarize: async (request, beforeAttempt) => {
      beforeAttempt();
      calls++;
      assert.ok(
        estimateTokens(request.system) + estimateTokens(request.prompt) <=
          budget.input,
      );
      return "Changed exported constants to use the new behavior.";
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.report.summaryRequests, 3);
  assert.equal(result.report.files[0].treatment, "summarized");
  assert.equal(result.report.files[0].partial, true);
  assert.ok(result.report.inputTokens <= budget.input);
  for (const summarize of [
    async () => "",
    async () => {
      throw new Error("summary failed");
    },
  ]) {
    await assert.rejects(
      prepareContext({
        diff: patch("x.ts", 10000),
        budget,
        buildPrompt,
        summarize,
      }),
      /summary/i,
    );
  }
});

test("glob patterns and config overrides are validated and merged", () => {
  assert.ok(matchesContextPattern("file.map", "**/*.map"));
  assert.ok(matchesContextPattern("src/generated/file.ts", "**/generated/**"));
  assert.ok(!matchesContextPattern("src/file.ts", "*.ts"));
  assert.ok(matchesContextPattern("a.ts", "?.ts"));
  const options = conventionsFromOptions({
    contextBudget: "16000",
    contextExclude: ["vendor/**"],
    summarize: true,
  });
  const { conventions } = resolveConventions([
    { source: "CLI", settings: options },
  ]);
  assert.equal(conventions.context.budgetTokens, 16000);
  assert.equal(conventions.context.outputTokens, 1024);
  assert.equal(conventions.context.summarize, true);
  assert.throws(
    () => conventionsFromOptions({ contextBudget: "NaN" }),
    /integer/,
  );
  assert.throws(
    () => conventionsFromOptions({ contextBudget: "100" }),
    /context/,
  );
});

test("large single lines, lockfile-only changes and metadata-only commits have bounded useful context", async () => {
  const budget = resolveContextBudget("custom", "local");
  for (const diff of [
    patch("bundle.js").replace('+export const value0 = "new behavior 界😀";', "+" + "界😀".repeat(100000)),
    patch("pnpm-lock.yaml", 10000),
    "diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n" + "diff --git a/a.bin b/a.bin\nnew file mode 100644\nBinary files /dev/null and b/a.bin differ\n",
  ]) {
    const result = await prepareContext({ diff, budget, buildPrompt });
    assert.ok(result.report.inputTokens <= budget.input);
    assert.ok(result.prompt.length > 100);
    assert.ok(!result.prompt.includes("\ufffd"));
  }
});

test("metadata overflow fails clearly, rename exclusions match original paths, and aborts are honored", async () => {
  const budget = resolveContextBudget("custom", "local");
  await assert.rejects(prepareContext({ diff: Array.from({ length: 1000 }, (_, i) => patch(`file-${i}.ts`)).join(""), budget, buildPrompt }), /metadata does not fit/);
  await assert.rejects(prepareContext({ diff: "diff --git a/private.txt b/public.txt\nsimilarity index 100%\nrename from private.txt\nrename to public.txt\n", budget: resolveContextBudget("custom", "local", { exclude: ["private.txt"] }), buildPrompt }), /No usable/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareContext({ diff: patch("x"), budget, buildPrompt, signal: controller.signal }), /aborted/);
});
