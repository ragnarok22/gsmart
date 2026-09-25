import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareContext,
  parseDiffFiles,
  matchesContextPattern,
  ContextMetadataOverflowError,
} from "../src/utils/diff-context.ts";
import {
  resolveContextBudget,
  estimateTokens,
  bytePrefix,
  MAX_CONTEXT_BUDGET,
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
    resolveContextBudget("openai", "constructor").source,
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
    patch("bundle.js").replace(
      '+export const value0 = "new behavior 界😀";',
      "+" + "界😀".repeat(100000),
    ),
    patch("pnpm-lock.yaml", 10000),
    "diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n" +
      "diff --git a/a.bin b/a.bin\nnew file mode 100644\nBinary files /dev/null and b/a.bin differ\n",
  ]) {
    const result = await prepareContext({ diff, budget, buildPrompt });
    assert.ok(result.report.inputTokens <= budget.input);
    assert.ok(result.prompt.length > 100);
    assert.ok(!result.prompt.includes("\ufffd"));
  }
});

test("representative excerpts retain the first and last changes across a large patch", async () => {
  const diff = [
    "diff --git a/source.ts b/source.ts",
    "--- a/source.ts",
    "+++ b/source.ts",
    "@@ -1 +1,10002 @@ firstChange()",
    "-old behavior",
    ...Array.from({ length: 10000 }, () => "+intermediate change"),
    "+export const lastChange = true;",
    "",
  ].join("\n");
  const result = await prepareContext({
    diff,
    budget: resolveContextBudget("custom", "local"),
    buildPrompt,
  });
  assert.match(result.prompt, /firstChange\(\)/);
  assert.match(result.prompt, /lastChange = true/);
  assert.match(result.prompt, /\+10001 -1/);
  assert.equal(result.report.files[0].treatment, "condensed");
  assert.ok(
    result.report.inputTokens +
      result.report.outputTokens +
      result.report.overheadTokens <=
      result.report.budgetTokens,
  );
});

test("metadata overflow fails clearly, rename exclusions match original paths, and aborts are honored", async () => {
  const budget = resolveContextBudget("custom", "local");
  await assert.rejects(
    prepareContext({
      diff: Array.from({ length: 1000 }, (_, i) => patch(`file-${i}.ts`)).join(
        "",
      ),
      budget,
      buildPrompt,
    }),
    /metadata does not fit/,
  );
  await assert.rejects(
    prepareContext({
      diff: "diff --git a/private.txt b/public.txt\nsimilarity index 100%\nrename from private.txt\nrename to public.txt\n",
      budget: resolveContextBudget("custom", "local", {
        exclude: ["private.txt"],
      }),
      buildPrompt,
    }),
    /No usable/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    prepareContext({
      diff: patch("x"),
      budget,
      buildPrompt,
      signal: controller.signal,
    }),
    /aborted/,
  );
});

test("metadata recovery accounts for UTF-8, prompt overhead, output reserve and excluded rename paths", async () => {
  const included = Array.from({ length: 180 }, (_, i) =>
    patch(`src/界😀-${i}.ts`),
  ).join("");
  const excluded =
    "diff --git a/private/old.ts b/public/new.ts\nsimilarity index 100%\nrename from private/old.ts\nrename to public/new.ts\n" +
    patch("private/secret.ts", 100);
  const budget = resolveContextBudget("custom", "local", {
    outputTokens: 2048,
    exclude: ["private/**"],
    summarize: true,
  });
  const prompt = (changes: string) => ({
    system: "Instructions 界😀. ".repeat(30),
    prompt: `History: fix: 保留行为\nPrevious candidate: feat: 更新\nFeedback: 更短\n${changes}`,
  });
  const failure = async (diff: string) =>
    prepareContext({ diff, budget, buildPrompt: prompt }).then(
      () => assert.fail("metadata should overflow the initial budget"),
      (error: unknown) => {
        assert.ok(error instanceof ContextMetadataOverflowError);
        return error;
      },
    );
  const error = await failure(included + excluded);
  assert.deepEqual(error.recovery, (await failure(included)).recovery);
  assert.equal(error.recovery.currentBudgetTokens, 8192);
  assert.equal(error.recovery.maxBudgetTokens, MAX_CONTEXT_BUDGET);
  assert.equal(error.recovery.modelWindow, undefined);
  assert.match(error.message, /selected model\/server capacity/);
  assert.match(error.message, /--history-examples 0/);
  assert.match(error.message, /--context-exclude "[^"]+"/);
  assert.doesNotMatch(error.message, /--summarize/);
  const budgetTokens = error.recovery.suggestedBudgetTokens;
  assert.equal(budgetTokens, error.recovery.requiredBudgetTokens);
  assert.ok(budgetTokens !== undefined && budgetTokens > budget.total);
  const result = await prepareContext({
    diff: included + excluded,
    budget: resolveContextBudget("custom", "local", {
      ...budget.settings,
      budgetTokens,
    }),
    buildPrompt: prompt,
    summarize: async () =>
      assert.fail("minimum metadata needs no AI summaries"),
  });
  assert.equal(
    result.report.inputTokens + budget.output + budget.overhead,
    budgetTokens,
  );
  assert.equal(
    result.report.files.filter((f) => f.treatment === "excluded").length,
    2,
  );
  assert.doesNotMatch(result.prompt, /private|public\/new/);
  await assert.rejects(
    prepareContext({
      diff: included + excluded,
      budget: resolveContextBudget("custom", "local", {
        ...budget.settings,
        budgetTokens: budgetTokens - 1,
      }),
      buildPrompt: prompt,
    }),
    ContextMetadataOverflowError,
  );
});

for (const [provider, model, count, limit, limitDescription] of [
  ["openai", "gpt-4o", 2600, 128_000, /known context window/],
  ["custom", "local", 20000, MAX_CONTEXT_BUDGET, /maximum context budget/],
] as const) {
  test(`metadata overflow beyond ${provider}/${model} limit has no unworkable budget recommendation`, async () => {
    const diff = Array.from({ length: count }, (_, i) =>
      patch(`file-${i}.ts`),
    ).join("");
    await assert.rejects(
      prepareContext({
        diff,
        budget: resolveContextBudget(provider, model),
        buildPrompt,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContextMetadataOverflowError);
        assert.equal(error.recovery.maxBudgetTokens, limit);
        assert.ok(error.recovery.requiredBudgetTokens > limit);
        assert.equal(error.recovery.suggestedBudgetTokens, undefined);
        assert.match(error.message, limitDescription);
        assert.ok(error.message.includes(String(limit)));
        assert.doesNotMatch(error.message, /--context-budget \d+|--summarize/);
        return true;
      },
    );
  });
}

test("a metadata recommendation exactly at the known model window is usable", async () => {
  const diff = Array.from({ length: 150 }, (_, i) =>
    patch(`file-${i}.ts`),
  ).join("");
  const budget = resolveContextBudget("openai", "gpt-4o", {
    budgetTokens: 8192,
  });
  const overflow = await prepareContext({ diff, budget, buildPrompt }).catch(
    (error) => {
      assert.ok(error instanceof ContextMetadataOverflowError);
      return error;
    },
  );
  assert.ok(overflow instanceof ContextMetadataOverflowError);
  const extraInstructions = 128_000 - overflow.recovery.requiredBudgetTokens;
  const prompt = (changes: string) => ({
    ...buildPrompt(changes),
    system: buildPrompt(changes).system + "x".repeat(extraInstructions),
  });
  await assert.rejects(
    prepareContext({
      diff,
      budget: resolveContextBudget("openai", "gpt-4o", {
        budgetTokens: 127_999,
      }),
      buildPrompt: prompt,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ContextMetadataOverflowError);
      assert.equal(error.recovery.suggestedBudgetTokens, 128_000);
      return true;
    },
  );
  const result = await prepareContext({
    diff,
    budget: resolveContextBudget("openai", "gpt-4o", { budgetTokens: 128_000 }),
    buildPrompt: prompt,
  });
  assert.equal(
    result.report.inputTokens + budget.output + budget.overhead,
    128_000,
  );
});

test("quoted copies decode tabs, newlines, quotes, backslashes and Unicode before applying exclusions", async () => {
  const original = 'source/line\nbreak\t"quoted"\\界😀.txt';
  const destination = 'target/line\nbreak\t"quoted"\\界😀.txt';
  const diff = [
    `diff --git ${JSON.stringify(`a/${original}`)} ${JSON.stringify(`b/${destination}`)}`,
    "similarity index 100%",
    `copy from ${JSON.stringify(original)}`,
    `copy to ${JSON.stringify(destination)}`,
    "",
  ].join("\n");
  const [file] = parseDiffFiles(diff);
  assert.equal(file.path, destination);
  assert.equal(file.originalPath, original);
  assert.match(file.metadata, /Change: copied; \+0 -0/);
  assert.ok(file.metadata.includes(JSON.stringify(destination)));
  assert.ok(
    !file.metadata.includes("\t"),
    "metadata should escape terminal controls",
  );
  await assert.rejects(
    prepareContext({
      diff,
      budget: resolveContextBudget("custom", "local", { exclude: [original] }),
      buildPrompt,
    }),
    /No usable AI context/,
  );
});

test("tight input budgets retain file metadata or a short excerpt without requesting summaries", async () => {
  const diff = patch("src/tight.ts", 1000);
  for (const [instructions, hasExcerpt] of [
    [6400, false],
    [6330, true],
  ] as const) {
    const result = await prepareContext({
      diff,
      budget: resolveContextBudget("custom", "local", { summarize: true }),
      buildPrompt: (changes) => ({
        system: "x".repeat(instructions),
        prompt: changes,
      }),
      summarize: async () =>
        assert.fail("insufficient summary space must use local reduction"),
    });
    assert.match(result.prompt, /File: "src\/tight.ts"/);
    assert.match(result.prompt, /\+1000 -1/);
    assert.equal(result.prompt.includes("Partial diff excerpts"), hasExcerpt);
    assert.equal(result.report.files[0].treatment, "condensed");
    assert.equal(result.report.summaryRequests, 0);
    assert.ok(
      result.report.inputTokens +
        result.report.outputTokens +
        result.report.overheadTokens <=
        result.report.budgetTokens,
    );
  }
});

test("oversized binary patches without text hunks retain file kind and bounded metadata", async () => {
  const diff =
    "diff --git a/image.bin b/image.bin\nnew file mode 100644\nGIT binary patch\nliteral 20000\n" +
    "z".repeat(20000) +
    "\n";
  const result = await prepareContext({
    diff,
    budget: resolveContextBudget("custom", "local"),
    buildPrompt,
  });
  assert.match(result.prompt, /added; \+0 -0; binary/);
  assert.equal(result.report.files[0].kind, "binary");
  assert.equal(result.report.files[0].treatment, "condensed");
  assert.doesNotMatch(result.prompt, /z{20000}/);
  assert.ok(result.report.inputTokens <= 6656);
});

test("complete summarization preserves every chunk across Unicode boundaries and reports full coverage", async () => {
  const diff = patch("src/unicode.ts", 300).replaceAll(
    "new behavior 界😀",
    "😀界é".repeat(10),
  );
  const chunks: string[] = [];
  const summaries: string[] = [];
  const budget = resolveContextBudget("custom", "local", {
    summarize: true,
    maxSummaryRequests: 16,
  });
  const result = await prepareContext({
    diff,
    budget,
    buildPrompt,
    summarize: async ({ prompt, system }, beforeAttempt) => {
      beforeAttempt();
      const separator = "not necessarily the whole change:\n";
      chunks.push(prompt.slice(prompt.indexOf(separator) + separator.length));
      assert.ok(
        estimateTokens(prompt) + estimateTokens(system) <= budget.input,
      );
      const summary = `Updated constants in section ${chunks.length}.`;
      summaries.push(summary);
      return summary;
    },
  });
  assert.ok(chunks.length > 1);
  assert.equal(
    chunks.join(""),
    diff,
    "all source bytes must survive chunk boundaries",
  );
  assert.equal(result.report.summaryRequests, chunks.length);
  assert.equal(result.report.files[0].partial, false);
  assert.equal(result.report.files[0].reason, "AI summary of all chunks");
  for (const summary of summaries) assert.ok(result.prompt.includes(summary));
});

test("long summaries are bounded in the final request and reported as partial", async () => {
  const budget = resolveContextBudget("custom", "local", {
    summarize: true,
    maxSummaryRequests: 8,
  });
  const summary = "Changes include " + "界😀".repeat(2000) + " LAST_NOTE";
  const result = await prepareContext({
    diff: patch("src/complete.ts", 200),
    budget,
    buildPrompt,
    summarize: async (_request, beforeAttempt) => {
      beforeAttempt();
      return summary;
    },
  });
  assert.ok(result.report.summaryRequests > 1);
  assert.ok(
    result.report.summaryRequests < 8,
    "all input chunks fit below the request cap",
  );
  assert.equal(result.report.files[0].partial, true);
  assert.equal(result.report.files[0].treatment, "summarized");
  assert.match(result.prompt, /Changes include/);
  assert.doesNotMatch(result.prompt, /LAST_NOTE|\ufffd/);
  assert.ok(result.report.inputTokens <= budget.input);
});

test("a budget that fits local metadata but not summary instructions fails before a provider call", async () => {
  await assert.rejects(
    prepareContext({
      diff: patch("src/file.ts", 1000),
      budget: resolveContextBudget("custom", "local", {
        budgetTokens: 1250,
        outputTokens: 256,
        summarize: true,
      }),
      buildPrompt: (changes) => ({ system: "", prompt: changes }),
      summarize: async () =>
        assert.fail("oversized summary instructions must not be sent"),
    }),
    /too small for a summarization request/,
  );
});
