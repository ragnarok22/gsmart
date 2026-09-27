import "../test-support/setup-env";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import esmock from "esmock";
import { runEvaluationCommand } from "../src/evaluate.ts";
import {
  buildCommitPrompt,
  COMMIT_PROMPT_VERSION,
} from "../src/utils/commit-prompt.ts";
import {
  annotationTemplate,
  DIMENSIONS,
  hashEvaluationData,
  loadEvaluationCorpus,
  runEvaluation,
  validateEvaluationReport,
  type EvaluationGenerator,
} from "../src/utils/evaluation.ts";
import { git, temporaryDirectory } from "../test-support/repository.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = fileURLToPath(
  new URL("../src/evaluate.ts", import.meta.url),
);
const offlineGuard = fileURLToPath(
  new URL("../test-support/evaluations/offline-guard.mjs", import.meta.url),
);
const corpus = await loadEvaluationCorpus(
  fileURLToPath(new URL("../test-support/evaluations/v1/", import.meta.url)),
);
const credential = "sk-evaluation-test-credential-never-persist";
const model = "offline-cli-test-model";
const fakeGenerator: EvaluationGenerator = async (request) => {
  const entry = corpus.cases.find(
    (entry) => entry.generation.branch === request.branch,
  )!;
  const [system, prompt] = buildCommitPrompt(
    request.branch,
    request.diff,
    request.conventions,
  );
  request.onPromptPrepared({ system, prompt });
  return corpus.syntax.fixtures.find(
    (fixture) => fixture.caseId === entry.id && fixture.valid,
  )!.message;
};

function liveArguments(output: string) {
  return [
    "--live",
    "--provider",
    "openai",
    "--model",
    model,
    "--output",
    output,
  ];
}

function fixtureReport() {
  return runEvaluation(
    corpus,
    { live: true, provider: "openai", model, runs: 1 },
    {
      loadGenerator: async () => fakeGenerator,
      promptVersion: COMMIT_PROMPT_VERSION,
    },
  );
}

function offlineCLI(directory: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      offlineGuard,
      "--import",
      import.meta.resolve("tsx"),
      entrypoint,
      ...args,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        GSMART_CONFIG_DIR: join(directory, "unused-config"),
        OPENAI_API_KEY: credential,
      },
    },
  );
}

function assertExit(result: ReturnType<typeof offlineCLI>, code: number) {
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, code, result.stderr);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(credential));
  if (code === 0) assert.equal(result.stderr, "");
  else {
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /Unhandled|Uncaught|^\s+at\s/m);
  }
}

async function readReport(path: string) {
  const bytes = await readFile(path, "utf8");
  const report: unknown = JSON.parse(bytes);
  validateEvaluationReport(report, corpus);
  assert.ok(bytes.endsWith("\n"), "reports end with a newline");
  assert.ok(!bytes.includes(credential));
  return report;
}

async function assertPreflightFailure(
  t: TestContext,
  output: string,
  expected: RegExp | { code: string },
  command = runEvaluationCommand,
) {
  const loadGenerator = t.mock.fn(async () => fakeGenerator);
  const loadCorpus = t.mock.fn(async () => corpus);
  const log = t.mock.fn();
  await assert.rejects(
    command(liveArguments(output), { loadGenerator, loadCorpus, log }),
    expected,
  );
  assert.equal(loadGenerator.mock.callCount(), 0);
  assert.equal(loadCorpus.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 0);
}

test("offline entrypoint writes an editable template and scores it using real files from outside the repository", async (t) => {
  const directory = temporaryDirectory(t);
  const report = await fixtureReport();
  const original = JSON.stringify(report);
  await writeFile(join(directory, "report.json"), original);

  const templated = offlineCLI(directory, [
    "--template",
    "report.json",
    "--output",
    "human annotations.json",
  ]);
  assertExit(templated, 0);
  assert.equal(
    templated.stdout,
    "Human annotation template written to human annotations.json\n",
  );
  const templateBytes = await readFile(
    join(directory, "human annotations.json"),
    "utf8",
  );
  const annotations = JSON.parse(templateBytes) as ReturnType<
    typeof annotationTemplate
  >;
  assert.deepEqual(annotations, annotationTemplate(report, corpus));
  assert.ok(templateBytes.endsWith("\n"));
  assert.ok(!templateBytes.includes(credential));

  for (const dimension of DIMENSIONS)
    annotations.samples[0].scores[dimension] = {
      score: dimension === "specificity" ? 1 : 2,
      rationale: "The diff supports this description of the renamed helper.",
      evidence: [corpus.cases[0].scorer.facts[0].id],
    };
  const reviewed = JSON.stringify(annotations);
  await writeFile(join(directory, "human annotations.json"), reviewed);
  const scoredResult = offlineCLI(directory, [
    "--score",
    "report.json",
    "--annotations",
    "human annotations.json",
    "--output",
    "scored.json",
  ]);
  assertExit(scoredResult, 0);
  const scored = await readReport(join(directory, "scored.json"));
  assert.deepEqual(JSON.parse(scoredResult.stdout), scored.summary);
  assert.equal(scored.summary.overall.scored, 1);
  assert.equal(scored.summary.overall.unscored, corpus.cases.length - 1);
  assert.equal(scored.summary.overall.dimensions.accuracy.mean, 2);
  assert.equal(scored.summary.overall.dimensions.specificity.mean, 1);
  assert.deepEqual(scored.samples[0].semantic, annotations.samples[0].scores);
  assert.deepEqual(scored.samples.slice(1), report.samples.slice(1));
  assert.deepEqual(scored.metadata, report.metadata);
  assert.equal(
    await readFile(join(directory, "report.json"), "utf8"),
    original,
  );
  assert.equal(
    await readFile(join(directory, "human annotations.json"), "utf8"),
    reviewed,
  );
  assert.deepEqual((await readdir(directory)).sort(), [
    "human annotations.json",
    "report.json",
    "scored.json",
  ]);
});

test("help returns before corpus, output, timeout, source or generator access", async (t) => {
  const directory = temporaryDirectory(t);
  const unused = t.mock.fn(() =>
    assert.fail("Help accessed an evaluation dependency"),
  );
  const log = t.mock.method(console, "log", () => {});
  const args = ["--", "--help", "--corpus", "missing-corpus", "--live"];
  assert.equal(
    await runEvaluationCommand(args, {
      loadCorpus: unused,
      loadGenerator: unused,
      ensureNewOutput: unused,
      readJSON: unused,
      writeJSON: unused,
      sourceRevision: unused,
      getTimeoutMs: unused,
    }),
    0,
  );
  assert.equal(unused.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 1);
  assert.match(log.mock.calls[0].arguments[0], /offline by default/);
  const result = offlineCLI(directory, args);
  assertExit(result, 0);
  assert.equal(result.stdout, `${log.mock.calls[0].arguments[0]}\n`);
  assert.deepEqual(await readdir(directory), []);
});

test("existing output is preserved and a missing parent fails before loading the generator", async (t) => {
  const directory = temporaryDirectory(t);
  const output = join(directory, "existing.json");
  const original = "An existing human review must not be replaced.\n";
  await writeFile(output, original);
  await assertPreflightFailure(
    t,
    output,
    /Output already exists; choose a new file/,
  );
  assert.equal(await readFile(output, "utf8"), original);

  await assertPreflightFailure(
    t,
    join(directory, "missing-parent", "report.json"),
    { code: "ENOENT" },
  );
  assert.deepEqual(await readdir(directory), ["existing.json"]);
});

test("output access errors and unwritable parents stop before generation without relying on chmod", async (t) => {
  for (const deniedAt of ["output", "parent"] as const) {
    await t.test(deniedAt, async (t) => {
      const directory = temporaryDirectory(t);
      const output = join(directory, "report.json");
      const calls: [string, number | undefined][] = [];
      const denied = Object.assign(
        new Error("EACCES: evaluation output is not writable"),
        { code: "EACCES" },
      );
      const { runEvaluationCommand: command } = await esmock(
        "../src/evaluate.ts",
        {
          "node:fs/promises": {
            access: async (path: string, mode?: number) => {
              calls.push([path, mode]);
              if (path === (deniedAt === "output" ? output : directory))
                throw denied;
              return access(path, mode);
            },
          },
        },
      );
      await assertPreflightFailure(t, output, { code: "EACCES" }, command);
      assert.deepEqual(
        calls,
        deniedAt === "output"
          ? [[output, undefined]]
          : [
              [output, undefined],
              [directory, constants.W_OK],
            ],
      );
      assert.deepEqual(await readdir(directory), []);
    });
  }
});

test("exclusive report creation preserves a competing file created after preflight", async (t) => {
  const output = join(temporaryDirectory(t), "report.json");
  const winner = "A concurrent writer owns this file.\n";
  const log = t.mock.method(console, "log", () => {});
  let calls = 0;
  await assert.rejects(
    runEvaluationCommand([...liveArguments(output), "--runs", "1"], {
      loadGenerator: async () => async (request) => {
        if (++calls === 1) await writeFile(output, winner, { flag: "wx" });
        return fakeGenerator(request);
      },
    }),
    { code: "EEXIST" },
  );
  assert.equal(
    calls,
    corpus.cases.length,
    "generation completed before the exclusive write failed",
  );
  assert.equal(await readFile(output, "utf8"), winner);
  assert.equal(
    log.mock.callCount(),
    0,
    "no success summary after a failed write",
  );
});

test("successful injected live generation writes default run counts, local Git provenance, timeout and summary", async (t) => {
  const output = join(temporaryDirectory(t), "report.json");
  const previousTimeout = process.env.GSMART_TIMEOUT;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.GSMART_TIMEOUT = "45000";
  process.env.OPENAI_API_KEY = credential;
  t.after(() => {
    if (previousTimeout === undefined) delete process.env.GSMART_TIMEOUT;
    else process.env.GSMART_TIMEOUT = previousTimeout;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const expectedSource = {
    revision: git(root, "rev-parse", "HEAD"),
    dirty: Boolean(
      git(root, "status", "--porcelain", "--untracked-files=normal"),
    ),
  };
  const log = t.mock.method(console, "log", () => {});
  const generate = t.mock.fn(fakeGenerator);
  const loadGenerator = t.mock.fn(async () => generate);
  assert.equal(
    await runEvaluationCommand(liveArguments(output), { loadGenerator }),
    0,
  );
  const report = await readReport(output);
  assert.equal(loadGenerator.mock.callCount(), 1);
  assert.equal(generate.mock.callCount(), corpus.cases.length * 3);
  assert.deepEqual(report.metadata, {
    provider: "openai",
    model,
    runs: 3,
    promptVersion: COMMIT_PROMPT_VERSION,
    corpus: { version: corpus.version, hash: hashEvaluationData(corpus) },
    rubric: {
      version: corpus.rubric.version,
      hash: hashEvaluationData(corpus.rubric),
    },
    source: expectedSource,
    transportAttempts: 1,
    timeoutMs: 45000,
  });
  assert.equal(report.summary.overall.syntaxValid, corpus.cases.length * 3);
  assert.equal(report.summary.overall.generationFailures, 0);
  assert.ok(report.samples.every((sample) => sample.error === null));
  for (const {
    arguments: [request],
  } of generate.mock.calls) {
    assert.equal(request.provider, "openai");
    assert.equal(request.model, model);
  }
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[0]), report.summary);
  assert.ok(!log.mock.calls[0].arguments[0].includes(credential));
});

test("failed live generation persists safe diagnostics and a summary before returning nonzero", async (t) => {
  for (const stage of ["setup", "generation"] as const) {
    await t.test(stage, async (t) => {
      const output = join(temporaryDirectory(t), "failed.json");
      const log = t.mock.method(console, "log", () => {});
      let calls = 0;
      assert.equal(
        await runEvaluationCommand([...liveArguments(output), "--runs", "1"], {
          loadGenerator: async () => {
            if (stage === "setup")
              throw new Error(`Credential loader failed: ${credential}`);
            return async (request) => {
              calls++;
              if (calls === 1)
                return {
                  error: `Bearer ${credential}`,
                  code: "AUTHENTICATION",
                };
              if (calls === 2)
                throw new Error(`Provider response body: ${credential}`);
              return fakeGenerator(request);
            };
          },
        }),
        1,
      );
      const report = await readReport(output);
      assert.equal(calls, stage === "setup" ? 0 : corpus.cases.length);
      assert.equal(
        report.summary.overall.generationFailures,
        stage === "setup" ? corpus.cases.length : 2,
      );
      assert.equal(report.samples[0].error?.stage, stage);
      assert.equal(
        report.samples[0].error?.code,
        stage === "setup" ? "GENERATION" : "AUTHENTICATION",
      );
      assert.equal(report.samples[1].error?.code, "GENERATION");
      assert.equal(log.mock.callCount(), 1);
      assert.deepEqual(
        JSON.parse(log.mock.calls[0].arguments[0]),
        report.summary,
      );
      assert.ok(!log.mock.calls[0].arguments[0].includes(credential));
    });
  }
});

test("live syntax failures retain the candidate and diagnostics in the written report", async (t) => {
  const output = join(temporaryDirectory(t), "invalid-syntax.json");
  const candidate = "This is not a conventional commit";
  const log = t.mock.method(console, "log", () => {});
  const generate = t.mock.fn(
    async (request: Parameters<EvaluationGenerator>[0]) => {
      await fakeGenerator(request);
      return candidate;
    },
  );
  assert.equal(
    await runEvaluationCommand([...liveArguments(output), "--runs", "1"], {
      loadGenerator: async () => generate,
    }),
    1,
  );
  const report = await readReport(output);
  assert.equal(generate.mock.callCount(), corpus.cases.length);
  assert.equal(report.summary.overall.syntaxInvalid, corpus.cases.length);
  assert.equal(report.summary.overall.generationFailures, 0);
  for (const sample of report.samples) {
    assert.equal(sample.output, candidate);
    assert.equal(sample.error, null);
    assert.equal(sample.syntax?.valid, false);
    assert.ok(sample.syntax!.diagnostics.length > 0);
  }
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[0]), report.summary);
});

test("offline check prints failed fixture diagnostics and returns nonzero", async (t) => {
  const changed = structuredClone(corpus);
  changed.syntax.fixtures[0].valid = !changed.syntax.fixtures[0].valid;
  const log = t.mock.method(console, "log", () => {});
  const loadGenerator = t.mock.fn(async () => fakeGenerator);
  assert.equal(
    await runEvaluationCommand(["--check"], {
      loadCorpus: async () => changed,
      loadGenerator,
    }),
    1,
  );
  assert.equal(loadGenerator.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 1);
  const check = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(check.valid, false);
  assert.equal(check.cases, corpus.cases.length);
  assert.deepEqual(
    check.fixtures
      .filter((fixture: { passed: boolean }) => !fixture.passed)
      .map((fixture: { id: string }) => fixture.id),
    [changed.syntax.fixtures[0].id],
  );
  assert.equal(
    check.fixtures[0].expectedValid,
    changed.syntax.fixtures[0].valid,
  );
  assert.equal(check.fixtures[0].valid, corpus.syntax.fixtures[0].valid);
});

test("unavailable Git metadata remains explicit without preventing a report", async (t) => {
  const revision = "a".repeat(40);
  for (const scenario of [
    {
      name: "Git executable unavailable",
      revision: {
        status: null,
        stdout: null,
        error: new Error("spawn git ENOENT"),
      },
      status: {
        status: null,
        stdout: null,
        error: new Error("spawn git ENOENT"),
      },
      expected: { revision: null, dirty: null },
    },
    {
      name: "HEAD unavailable but status is clean",
      revision: { status: 128, stdout: "HEAD\n" },
      status: { status: 0, stdout: "" },
      expected: { revision: null, dirty: false },
    },
    {
      name: "status unavailable but HEAD resolves",
      revision: { status: 0, stdout: `${revision}\n` },
      status: { status: 128, stdout: "" },
      expected: { revision, dirty: null },
    },
  ]) {
    await t.test(scenario.name, async (t) => {
      const output = join(temporaryDirectory(t), "report.json");
      const spawn = t.mock.fn(
        (
          command: string,
          args: string[],
          options: { cwd: string; encoding: string },
        ) => {
          assert.equal(command, "git");
          assert.deepEqual(options, { cwd: root, encoding: "utf8" });
          return args[0] === "rev-parse" ? scenario.revision : scenario.status;
        },
      );
      const { runEvaluationCommand: command } = await esmock(
        "../src/evaluate.ts",
        {
          "node:child_process": { spawnSync: spawn },
        },
      );
      assert.equal(
        await command([...liveArguments(output), "--runs", "1"], {
          loadGenerator: async () => fakeGenerator,
          log: () => {},
        }),
        0,
      );
      const report = await readReport(output);
      assert.deepEqual(report.metadata.source, scenario.expected);
      assert.deepEqual(
        spawn.mock.calls.map((call) => call.arguments[1]),
        [
          ["rev-parse", "HEAD"],
          ["status", "--porcelain", "--untracked-files=normal"],
        ],
      );
    });
  }
});

test("real entrypoint returns useful stderr for argument, filesystem and report errors without creating output", async (t) => {
  const directory = temporaryDirectory(t);
  const report = await fixtureReport();
  const original = JSON.stringify(report);
  await writeFile(join(directory, "report.json"), original);
  await writeFile(join(directory, "malformed.json"), "[");
  await writeFile(join(directory, "invalid-report.json"), "{}");
  const missingPrompt = structuredClone(report);
  missingPrompt.samples[0].request.promptHash = null;
  await writeFile(
    join(directory, "missing-prompt.json"),
    JSON.stringify(missingPrompt),
  );
  await writeFile(
    join(directory, "wrong-annotations.json"),
    JSON.stringify({
      ...annotationTemplate(report, corpus),
      reportId: "another-report",
    }),
  );
  const before = (await readdir(directory)).sort();
  const output = ["--output", "unused.json"];
  for (const scenario of [
    {
      name: "unknown option",
      args: ["--unknown"],
      error: /Unknown option.*--unknown/,
    },
    {
      name: "conflicting modes",
      args: ["--check", "--live"],
      error: /Choose one mode/,
    },
    {
      name: "invalid run count",
      args: [...liveArguments("unused.json"), "--runs", "0"],
      error: /--runs must be an integer from 1 to 100/,
    },
    {
      name: "missing corpus",
      args: ["--check", "--corpus", "missing-corpus"],
      error: /ENOENT.*cases\.json/,
    },
    {
      name: "existing output",
      args: ["--template", "report.json", "--output", "report.json"],
      error: /Output already exists; choose a new file/,
    },
    {
      name: "missing output parent",
      args: [
        "--template",
        "report.json",
        "--output",
        "missing-parent/report.json",
      ],
      error: /ENOENT.*missing-parent/,
    },
    {
      name: "missing report",
      args: ["--template", "absent-report.json", ...output],
      error: /ENOENT.*absent-report\.json/,
    },
    {
      name: "malformed report JSON",
      args: ["--template", "malformed.json", ...output],
      error: /JSON|Unexpected/,
    },
    {
      name: "invalid report format",
      args: ["--template", "invalid-report.json", ...output],
      error: /Unsupported report format/,
    },
    {
      name: "missing prompt provenance",
      args: ["--template", "missing-prompt.json", ...output],
      error: /Missing prompt hash must be recorded as an error/,
    },
    {
      name: "missing annotations",
      args: [
        "--score",
        "report.json",
        "--annotations",
        "absent-annotations.json",
        ...output,
      ],
      error: /ENOENT.*absent-annotations\.json/,
    },
    {
      name: "mismatched annotations",
      args: [
        "--score",
        "report.json",
        "--annotations",
        "wrong-annotations.json",
        ...output,
      ],
      error: /Annotations do not match report\/corpus\/rubric identity/,
    },
  ]) {
    await t.test(scenario.name, () => {
      const result = offlineCLI(directory, scenario.args);
      assertExit(result, 1);
      assert.match(result.stderr, scenario.error);
      assert.equal(existsSync(join(directory, "unused.json")), false);
    });
  }
  assert.equal(
    await readFile(join(directory, "report.json"), "utf8"),
    original,
  );
  assert.deepEqual((await readdir(directory)).sort(), before);
});
