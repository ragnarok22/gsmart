import "../test-support/setup-env";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esmock from "esmock";
import {
  annotationTemplate,
  applyAnnotations,
  checkEvaluationCorpus,
  DIMENSIONS,
  effectiveCaseConventions,
  hashEvaluationData,
  loadEvaluationCorpus,
  resolveEvaluationTimeout,
  runEvaluation,
  validateCorpus,
  validateEvaluationReport,
  type EvaluationGenerator,
} from "../src/utils/evaluation.ts";
import { runEvaluationCommand } from "../src/evaluate.ts";
import { buildCommitPrompt } from "../src/utils/commit-prompt.ts";
import { DEFAULT_TIMEOUT_MS } from "../src/utils/constants.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const corpusPath = fileURLToPath(
  new URL("../test-support/evaluations/v1/", import.meta.url),
);
const corpus = await loadEvaluationCorpus(corpusPath);
const live = {
  live: true,
  provider: "openai",
  model: "explicit-test-model",
  runs: 1,
};
const sampleOutput = (branch: string) => {
  const entry = corpus.cases.find(
    (entry) => entry.generation.branch === branch,
  )!;
  return corpus.syntax.fixtures.find(
    (fixture) => fixture.caseId === entry.id && fixture.valid,
  )!.message;
};
const successful: EvaluationGenerator = async (request) => {
  const [system, prompt] = buildCommitPrompt(
    request.branch,
    request.diff,
    request.conventions,
  );
  request.onPromptPrepared({ system, prompt });
  request.onContextPrepared({
    budgetTokens: 32000,
    budgetSource: "test",
    inputTokens: 200,
    outputTokens: 1024,
    overheadTokens: 256,
    summaryRequests: 0,
    files: [],
  });
  return sampleOutput(request.branch);
};
const dependencies = (generate: EvaluationGenerator = successful) => ({
  loadGenerator: async () => generate,
  promptVersion: "test-prompt-v1",
  createId: () => "test-report",
  now: () => new Date("2026-01-01T00:00:00Z"),
});

test("versioned corpus has grounded evidence, parseable Git patches and passing deterministic syntax fixtures", () => {
  const check = checkEvaluationCorpus(corpus);
  assert.equal(check.cases, 6);
  assert.equal(
    check.valid,
    true,
    JSON.stringify(check.fixtures.filter((fixture) => !fixture.passed)),
  );
  for (const entry of corpus.cases) {
    const parsed = spawnSync("git", ["apply", "--numstat", "-"], {
      cwd: root,
      encoding: "utf8",
      input: entry.generation.diff,
    });
    assert.equal(parsed.status, 0, `${entry.id}: ${parsed.stderr}`);
    assert.ok(parsed.stdout.trim());
  }
});

test("corpus rejects stale evidence, duplicate IDs, missing categories, bad conventions and scorer leakage", () => {
  const mutations = [
    (copy: typeof corpus) => {
      copy.cases[0].scorer.facts[0].evidence = ["not in this diff"];
    },
    (copy: typeof corpus) => {
      copy.cases[1].id = copy.cases[0].id;
    },
    (copy: typeof corpus) => {
      copy.cases[0].category = "mixed";
    },
    (copy: typeof corpus) => {
      copy.cases[0].generation.conventions.scope = "invalid" as "required";
    },
    (copy: typeof corpus) => {
      Object.assign(copy.cases[0].generation, { scorer: copy.cases[0].scorer });
    },
    (copy: typeof corpus) => {
      copy.cases[0].generation.conventions.context = { summarize: true };
    },
    (copy: typeof corpus) => {
      copy.syntax.fixtures[0].caseId = "missing";
    },
    (copy: typeof corpus) => {
      delete (copy.rubric.dimensions as Partial<typeof copy.rubric.dimensions>)
        .accuracy;
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(corpus);
    mutate(copy);
    assert.throws(() => validateCorpus(copy));
  }
});

test("data hashes are canonical, versioned and sensitive to scorer and diff changes", () => {
  assert.equal(
    hashEvaluationData({ b: 2, a: 1 }),
    hashEvaluationData({ a: 1, b: 2 }),
  );
  assert.notEqual(hashEvaluationData([1, 2]), hashEvaluationData([2, 1]));
  for (const mutate of [
    (copy: typeof corpus) => {
      copy.version = "v2";
    },
    (copy: typeof corpus) => {
      copy.cases[0].generation.diff += "\n";
    },
    (copy: typeof corpus) => {
      copy.cases[0].scorer.unsupportedClaims.push("New unsupported claim");
    },
    (copy: typeof corpus) => {
      copy.rubric.dimensions.accuracy["2"] += " Revised anchor.";
    },
  ]) {
    const copy = structuredClone(corpus);
    mutate(copy);
    assert.notEqual(hashEvaluationData(copy), hashEvaluationData(corpus));
  }
});

test("timeout metadata resolves positive GSMART_TIMEOUT values and safely defaults invalid settings", () => {
  for (const value of [
    undefined,
    "",
    " ",
    "0",
    "-1",
    "NaN",
    "Infinity",
    "SECRET-invalid-setting",
  ]) {
    assert.equal(resolveEvaluationTimeout(value), DEFAULT_TIMEOUT_MS);
  }
  assert.equal(resolveEvaluationTimeout("45000"), 45000);
  assert.equal(resolveEvaluationTimeout(" 120000 "), 120000);
  assert.equal(resolveEvaluationTimeout("1e3"), 1000);
  assert.equal(resolveEvaluationTimeout("0.5"), 0.5);
});

test("runner refuses implicit live calls and missing explicit settings before loading AI", async () => {
  let loaded = 0;
  const deps = {
    ...dependencies(),
    loadGenerator: async () => {
      loaded++;
      return successful;
    },
  };
  for (const options of [
    {},
    { ...live, live: false },
    { ...live, provider: undefined },
    { ...live, model: undefined },
    { ...live, model: " " },
    { ...live, provider: "unknown" },
    { ...live, runs: 0 },
    { ...live, runs: 1.5 },
  ])
    await assert.rejects(runEvaluation(corpus, options, deps));
  const broken = structuredClone(corpus);
  broken.syntax.fixtures[0].valid = false;
  await assert.rejects(runEvaluation(broken, live, deps), /syntax fixtures/);
  await assert.rejects(
    runEvaluation(corpus, live, { ...deps, timeoutMs: Infinity }),
    /Timeout/,
  );
  assert.equal(loaded, 0);
});

test("runner records all three runs, actual prepared prompt hashes, provenance and unscored semantics", async () => {
  let calls = 0;
  const prepared = {
    system: "actual post-context system",
    prompt: "actual reduced context and instructions",
  };
  const report = await runEvaluation(
    corpus,
    { ...live, runs: 3, source: { revision: "abc123", dirty: true } },
    dependencies(async (request) => {
      calls++;
      await successful(request);
      request.onPromptPrepared(prepared);
      return sampleOutput(request.branch);
    }),
  );
  assert.equal(calls, 18);
  assert.equal(report.samples.length, 18);
  assert.equal(report.metadata.provider, live.provider);
  assert.equal(report.metadata.model, live.model);
  assert.equal(report.metadata.promptVersion, "test-prompt-v1");
  assert.equal(report.metadata.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(report.metadata.corpus.hash, hashEvaluationData(corpus));
  assert.equal(report.metadata.rubric.hash, hashEvaluationData(corpus.rubric));
  assert.deepEqual(report.metadata.source, { revision: "abc123", dirty: true });
  assert.equal(new Set(report.samples.map((sample) => sample.id)).size, 18);
  for (const sample of report.samples) {
    assert.equal(sample.request.promptHash, hashEvaluationData(prepared));
    assert.equal(sample.outputHash, hashEvaluationData(sample.output));
    assert.equal(sample.contextReport?.summaryRequests, 0);
    assert.equal(sample.syntax?.valid, true);
    assert.equal(sample.error, null);
    assert.deepEqual(
      sample.request.effectiveConventions,
      effectiveCaseConventions(
        corpus.cases.find((entry) => entry.id === sample.caseId)!,
      ),
    );
    assert.ok(
      DIMENSIONS.every(
        (dimension) => sample.semantic[dimension].score === null,
      ),
    );
  }
  assert.equal(report.summary.overall.scored, 0);
  assert.equal(report.summary.overall.dimensions.accuracy.mean, null);
  assert.equal(report.summary.byCase[corpus.cases[0].id].distinctOutputs, 1);
  validateEvaluationReport(report, corpus);
});

test("generation projection and prompts exclude scorer-only facts, acceptable choices and rubric anchors", async () => {
  const copy = structuredClone(corpus);
  copy.cases[0].scorer.facts[0].claim = "SCORER_ONLY_FACT_SENTINEL";
  copy.cases[0].scorer.types = ["SCORER_ONLY_TYPE_SENTINEL"];
  copy.cases[0].scorer.scopes = ["SCORER_ONLY_SCOPE_SENTINEL"];
  copy.cases[0].scorer.unsupportedClaims = ["SCORER_ONLY_CLAIM_SENTINEL"];
  let observed = 0;
  const report = await runEvaluation(
    copy,
    live,
    dependencies(async (request) => {
      observed++;
      assert.deepEqual(Object.keys(request).sort(), [
        "branch",
        "conventions",
        "diff",
        "model",
        "onContextPrepared",
        "onPromptPrepared",
        "provider",
      ]);
      const prepared = buildCommitPrompt(
        request.branch,
        request.diff,
        request.conventions,
      );
      assert.doesNotMatch(JSON.stringify([request, prepared]), /SCORER_ONLY/);
      assert.ok(
        !JSON.stringify(prepared).includes(
          copy.rubric.dimensions.accuracy["0"],
        ),
      );
      return successful(request);
    }),
  );
  assert.equal(observed, 6);
  // The runner intentionally catches generator errors, including assertion failures.
  assert.ok(report.samples.every((sample) => sample.error === null));
});

test("live adapter hashes the actual AIBuilder transport request, with explicit settings and no quality retries", async (t) => {
  const previousTimeout = process.env.GSMART_TIMEOUT;
  process.env.GSMART_TIMEOUT = "45000";
  t.after(() => {
    if (previousTimeout === undefined) delete process.env.GSMART_TIMEOUT;
    else process.env.GSMART_TIMEOUT = previousTimeout;
  });
  const requests: { system: string; prompt: string }[] = [];
  const { loadLiveGenerator } = await esmock.p(
    "../src/evaluate.ts",
    {},
    {
      ai: {
        generateText: async (request: {
          system: string;
          prompt: string;
          maxRetries: number;
          model: { modelId: string };
          timeout: { totalMs: number };
        }) => {
          assert.equal(request.maxRetries, 0, "SDK retries are disabled");
          assert.equal(request.model.modelId, live.model);
          assert.equal(request.timeout.totalMs, 45000);
          requests.push({ system: request.system, prompt: request.prompt });
          // Invalid syntax must still produce exactly one call per case.
          return { text: "invalid candidate", finishReason: "stop" };
        },
      },
      "../src/utils/config.ts": {
        default: {
          getKey: () => "fake-evaluation-key",
          getModel: () => "saved-model-must-not-win",
          getOpenAIAuthMode: () => "api-key",
          getOpenAIOAuthTokens: () => null,
        },
        validateApiKey: () => null,
      },
    },
  );
  const withInstructions = structuredClone(corpus);
  withInstructions.cases[0].generation.conventions.instructions =
    "Keep wording concise.";
  const report = await runEvaluation(withInstructions, live, {
    ...dependencies(),
    loadGenerator: loadLiveGenerator,
    timeoutMs: resolveEvaluationTimeout(process.env.GSMART_TIMEOUT),
  });
  assert.equal(requests.length, 6);
  assert.equal(report.summary.overall.syntaxInvalid, 6);
  assert.equal(report.metadata.model, live.model);
  assert.equal(report.metadata.timeoutMs, 45000);
  assert.match(
    requests[0].prompt,
    /Additional instructions:\nKeep wording concise\./,
  );
  for (const [index, sample] of report.samples.entries())
    assert.equal(
      sample.request.promptHash,
      hashEvaluationData(requests[index]),
    );
  assert.doesNotMatch(JSON.stringify(report), /fake-evaluation-key/);
});

test("runner retains generation and syntax failures without quality retries or unsafe errors", async () => {
  let calls = 0;
  const report = await runEvaluation(
    corpus,
    live,
    dependencies(async (request) => {
      calls++;
      if (calls === 1)
        return { error: "Bearer SECRET_RAW_API_KEY", code: "AUTHENTICATION" };
      if (calls === 2) throw new Error("SDK response body SECRET_RAW_API_KEY");
      await successful(request);
      return calls === 3
        ? "not a conventional commit"
        : sampleOutput(request.branch);
    }),
  );
  assert.equal(calls, 6);
  assert.equal(report.samples[0].error?.code, "AUTHENTICATION");
  assert.equal(report.samples[0].request.promptHash, null);
  assert.equal(report.samples[1].error?.code, "GENERATION");
  assert.equal(report.samples[2].output, "not a conventional commit");
  assert.equal(report.samples[2].syntax?.valid, false);
  assert.ok(report.samples[2].syntax!.diagnostics.length > 0);
  assert.equal(report.summary.overall.generationFailures, 2);
  assert.equal(report.summary.overall.syntaxInvalid, 1);
  assert.equal(report.summary.overall.syntaxValid, 3);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|Bearer|response body/);
  validateEvaluationReport(report, corpus);
});

test("loader failure retains every requested slot and missing prompt instrumentation is explicit", async () => {
  const failed = await runEvaluation(corpus, live, {
    ...dependencies(),
    loadGenerator: async () => {
      throw new Error("credential SECRET");
    },
  });
  assert.equal(failed.summary.overall.generationFailures, 6);
  assert.ok(failed.samples.every((sample) => sample.error?.stage === "setup"));
  assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
  validateEvaluationReport(failed, corpus);
  const missingHook = await runEvaluation(
    corpus,
    live,
    dependencies(async (request) => sampleOutput(request.branch)),
  );
  assert.equal(
    missingHook.samples[0].output,
    sampleOutput(corpus.cases[0].generation.branch),
  );
  assert.equal(missingHook.samples[0].error?.code, "INSTRUMENTATION");
  assert.equal(missingHook.summary.overall.otherErrors, 6);
});

function ratedTemplate(report: Awaited<ReturnType<typeof runEvaluation>>) {
  const template = annotationTemplate(report, corpus);
  for (const dimension of DIMENSIONS)
    template.samples[0].scores[dimension] = {
      score: 2,
      rationale: "Matches the evidenced change without extrapolation.",
      evidence: [corpus.cases[0].scorer.facts[0].id],
    };
  return template;
}

test("human annotations stay linked to outputs and aggregate only scored samples", async () => {
  const report = await runEvaluation(
    corpus,
    { ...live, runs: 3 },
    dependencies(),
  );
  const template = ratedTemplate(report);
  const scored = applyAnnotations(report, template, corpus);
  assert.equal(report.summary.overall.scored, 0, "ingestion is pure");
  assert.equal(scored.summary.overall.scored, 1);
  assert.equal(scored.summary.overall.unscored, 17);
  assert.equal(scored.summary.overall.dimensions.accuracy.mean, 2);
  assert.equal(scored.summary.overall.dimensions.accuracy.distribution["2"], 1);
  assert.equal(scored.summary.byCase[corpus.cases[0].id].scored, 1);
  const second = annotationTemplate(scored, corpus);
  second.samples = [second.samples[1]];
  for (const dimension of DIMENSIONS)
    second.samples[0].scores[dimension] = {
      score: 0,
      rationale: "Reviewer found the claim misleading.",
      evidence: ["diff"],
    };
  const combined = applyAnnotations(scored, second, corpus);
  assert.equal(combined.summary.overall.dimensions.accuracy.mean, 1);
  assert.equal(combined.summary.overall.dimensions.accuracy.min, 0);
  assert.equal(combined.summary.overall.dimensions.accuracy.max, 2);
});

test("annotation ingestion rejects misattribution, partial/invalid scores and missing human evidence", async () => {
  const report = await runEvaluation(corpus, live, dependencies());
  const template = ratedTemplate(report);
  const mutations = [
    (copy: typeof template) => {
      copy.reportId = "different-report";
    },
    (copy: typeof template) => {
      copy.corpusHash = "0".repeat(64);
    },
    (copy: typeof template) => {
      copy.rubricHash = "0".repeat(64);
    },
    (copy: typeof template) => {
      copy.samples[0].outputHash = "0".repeat(64);
    },
    (copy: typeof template) => {
      copy.samples[0].sampleId = "missing";
    },
    (copy: typeof template) => {
      copy.samples.push(copy.samples[0]);
    },
    (copy: typeof template) => {
      copy.samples[0].scores.accuracy.score = 3 as 2;
    },
    (copy: typeof template) => {
      copy.samples[0].scores.accuracy.score = 0.5 as 0;
    },
    (copy: typeof template) => {
      copy.samples[0].scores.accuracy.score = null;
    },
    (copy: typeof template) => {
      copy.samples[0].scores.accuracy.rationale = " ";
    },
    (copy: typeof template) => {
      copy.samples[0].scores.accuracy.evidence = [];
    },
    (copy: typeof template) => {
      copy.samples[0].scores.accuracy.evidence = ["invented-fact"];
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(template);
    mutate(copy);
    assert.throws(() => applyAnnotations(report, copy, corpus));
  }
  const changed = structuredClone(report);
  changed.samples[0].output += " altered";
  assert.throws(
    () => applyAnnotations(changed, template, corpus),
    /Output hash/,
  );
  const shortened = structuredClone(report);
  shortened.samples.pop();
  assert.throws(
    () => validateEvaluationReport(shortened, corpus),
    /retain every/,
  );
  const invalidTimeout = structuredClone(report);
  invalidTimeout.metadata.timeoutMs = -1;
  assert.throws(
    () => validateEvaluationReport(invalidTimeout, corpus),
    /timeout metadata/,
  );
});

test("CLI defaults offline, gates live flags, and writes failures before returning nonzero", async () => {
  let loaded = 0;
  let timeoutReads = 0;
  let written: unknown;
  const deps = {
    loadGenerator: async () => {
      loaded++;
      return (async () => ({
        error: "SECRET",
        code: "AUTHENTICATION",
      })) as EvaluationGenerator;
    },
    loadCorpus: async () => corpus,
    ensureNewOutput: async () => {},
    writeJSON: async (_path: string, value: unknown) => {
      written = value;
    },
    sourceRevision: () => ({ revision: null, dirty: null }),
    getTimeoutMs: () => {
      timeoutReads++;
      return 90000;
    },
    log: () => {},
  };
  assert.equal(await runEvaluationCommand([], deps), 0);
  assert.equal(await runEvaluationCommand(["--", "--check"], deps), 0);
  for (const flags of [
    ["--provider", "openai"],
    ["--check", "--live"],
    ["--live"],
    [
      "--live",
      "--provider",
      "openai",
      "--model",
      "test",
      "--runs",
      "1e2",
      "--output",
      "fake.json",
    ],
    ["--live", "--provider", "openai", "--model", "test"],
    ["--score", "report.json", "--output", "scored.json"],
    ["--annotations", "annotations.json"],
    ["--output", "report.json"],
  ])
    await assert.rejects(runEvaluationCommand(flags, deps));
  assert.equal(loaded, 0);
  assert.equal(timeoutReads, 0);
  assert.equal(written, undefined);
  const liveFlags = [
    "--live",
    "--provider",
    "openai",
    "--model",
    "test",
    "--runs",
    "1",
    "--output",
    "fake.json",
  ];
  await assert.rejects(
    runEvaluationCommand(liveFlags, {
      ...deps,
      ensureNewOutput: async () => {
        throw new Error("exists");
      },
    }),
    /exists/,
  );
  assert.equal(loaded, 0);
  assert.equal(await runEvaluationCommand(liveFlags, deps), 1);
  assert.equal(loaded, 1);
  assert.equal(timeoutReads, 1);
  const saved = written as unknown;
  validateEvaluationReport(saved, corpus);
  assert.equal(saved.samples.length, 6);
  assert.equal(saved.metadata.timeoutMs, 90000);
  assert.doesNotMatch(JSON.stringify(saved), /SECRET/);
});

test("CLI templates and scores reports without entering the live dependency boundary", async () => {
  const report = await runEvaluation(corpus, live, dependencies());
  let written: unknown;
  const deps = {
    loadCorpus: async () => corpus,
    loadGenerator: async (): Promise<EvaluationGenerator> => {
      assert.fail("offline mode loaded AI");
    },
    getTimeoutMs: () => {
      assert.fail("offline scoring resolved live timeout");
    },
    readJSON: async (path: string) =>
      path === "report.json" ? report : ratedTemplate(report),
    ensureNewOutput: async () => {},
    writeJSON: async (_path: string, value: unknown) => {
      written = value;
    },
    log: () => {},
  };
  assert.equal(
    await runEvaluationCommand(
      ["--template", "report.json", "--output", "annotations.json"],
      deps,
    ),
    0,
  );
  assert.deepEqual(written, annotationTemplate(report, corpus));
  assert.equal(
    await runEvaluationCommand(
      [
        "--score",
        "report.json",
        "--annotations",
        "annotations.json",
        "--output",
        "scored.json",
      ],
      deps,
    ),
    0,
  );
  validateEvaluationReport(written, corpus);
  assert.equal(written.summary.overall.scored, 1);
});

test("real offline entrypoint cannot import AI/credential modules or make network calls", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./test-support/evaluations/offline-guard.mjs",
      "--import",
      "tsx",
      "src/evaluate.ts",
      "--check",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GSMART_CONFIG_DIR: "/dev/null/no-credential-access",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const check = JSON.parse(result.stdout);
  assert.equal(check.valid, true);
  assert.equal(check.cases, 6);
});
