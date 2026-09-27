import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { COMMIT_PROMPT_VERSION } from "./utils/commit-prompt";
import {
  annotationTemplate,
  applyAnnotations,
  checkEvaluationCorpus,
  loadEvaluationCorpus,
  resolveEvaluationTimeout,
  runEvaluation,
  validateLiveOptions,
  type EvaluationGenerator,
  type SourceRevision,
} from "./utils/evaluation";

const root = fileURLToPath(new URL("../", import.meta.url));
const defaultCorpus = fileURLToPath(
  new URL("../test-support/evaluations/v1/", import.meta.url),
);
const HELP = `Developer commit-message evaluation (offline by default)

pnpm run eval --check
pnpm run eval --live --provider <provider> --model <model> --runs 3 --output report.json
pnpm run eval --template report.json --output annotations.json
pnpm run eval --score report.json --annotations annotations.json --output scored.json

Optional: --corpus <directory> (defaults to test-support/evaluations/v1).
Live calls use configured credentials and can incur costs. No AI semantic judge.
Outputs must be new files. See test-support/evaluations/README.md for the rubric.`;

/** This is the sole AI/config import boundary. Offline modes never call it. */
export async function loadLiveGenerator(): Promise<EvaluationGenerator> {
  const { AIBuilder } = await import("./utils/ai");
  return async (request) =>
    new AIBuilder(request.provider, "").generateCommitMessage(
      request.branch,
      request.diff,
      {
        model: request.model,
        conventions: request.conventions,
        // AIBuilder's retry limit is a one-based attempt count.
        maxRetries: 1,
        onPromptPrepared: request.onPromptPrepared,
        onContextPrepared: request.onContextPrepared,
      },
    );
}

function sourceRevision(): SourceRevision {
  const git = (args: string[]) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const revision = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain", "--untracked-files=normal"]);
  return {
    revision: revision.status === 0 ? revision.stdout.trim() : null,
    dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null,
  };
}

const defaultDeps = {
  loadGenerator: loadLiveGenerator,
  loadCorpus: loadEvaluationCorpus,
  readJSON: async (path: string): Promise<unknown> =>
    JSON.parse(await readFile(path, "utf8")),
  ensureNewOutput: async (path: string) => {
    try {
      await access(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Fail before paid calls if the output's parent is missing or unwritable.
        await access(dirname(resolve(path)), constants.W_OK);
        return;
      }
      throw error;
    }
    throw new Error("Output already exists; choose a new file");
  },
  writeJSON: async (path: string, value: unknown) => {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
  },
  sourceRevision,
  getTimeoutMs: () => resolveEvaluationTimeout(process.env.GSMART_TIMEOUT),
  log: (message: string) => console.log(message),
};

export async function runEvaluationCommand(
  argv: string[],
  dependencies: Partial<typeof defaultDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...dependencies };
  const { values } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    options: {
      check: { type: "boolean" },
      live: { type: "boolean" },
      help: { type: "boolean" },
      provider: { type: "string" },
      model: { type: "string" },
      runs: { type: "string" },
      output: { type: "string" },
      corpus: { type: "string" },
      template: { type: "string" },
      score: { type: "string" },
      annotations: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    deps.log(HELP);
    return 0;
  }
  const modes = [
    values.check,
    values.live,
    values.template !== undefined,
    values.score !== undefined,
  ].filter(Boolean).length;
  if (modes > 1)
    throw new Error("Choose one mode: --check, --live, --template or --score");
  if (
    !values.live &&
    (values.provider !== undefined ||
      values.model !== undefined ||
      values.runs !== undefined)
  )
    throw new Error("Provider/model/runs require --live");
  if (values.annotations !== undefined && values.score === undefined)
    throw new Error("--annotations requires --score");
  if (values.live)
    validateLiveOptions({
      live: true,
      provider: values.provider,
      model: values.model,
      runs:
        values.runs === undefined
          ? 3
          : /^\d+$/.test(values.runs)
            ? Number(values.runs)
            : NaN,
    });
  if (values.score !== undefined && !values.annotations)
    throw new Error("--score requires --annotations");
  const writes =
    values.live || values.template !== undefined || values.score !== undefined;
  if (writes && !values.output)
    throw new Error("This mode requires --output <new-file>");
  if (!writes && values.output !== undefined)
    throw new Error("--output requires --live, --template or --score");
  if (writes) await deps.ensureNewOutput(values.output!);
  const corpus = await deps.loadCorpus(values.corpus ?? defaultCorpus);
  if (values.live) {
    const report = await runEvaluation(
      corpus,
      {
        live: true,
        provider: values.provider,
        model: values.model,
        runs: values.runs === undefined ? 3 : Number(values.runs),
        source: deps.sourceRevision(),
      },
      {
        loadGenerator: deps.loadGenerator,
        promptVersion: COMMIT_PROMPT_VERSION,
        timeoutMs: deps.getTimeoutMs(),
      },
    );
    await deps.writeJSON(values.output!, report);
    deps.log(JSON.stringify(report.summary, null, 2));
    return report.samples.some(
      (sample) => sample.error || !sample.syntax?.valid,
    )
      ? 1
      : 0;
  }
  const reportPath = values.template ?? values.score;
  if (reportPath !== undefined) {
    const report = await deps.readJSON(reportPath);
    if (values.template !== undefined) {
      await deps.writeJSON(values.output!, annotationTemplate(report, corpus));
      deps.log(`Human annotation template written to ${values.output}`);
    } else {
      const scored = applyAnnotations(
        report,
        await deps.readJSON(values.annotations!),
        corpus,
      );
      await deps.writeJSON(values.output!, scored);
      deps.log(JSON.stringify(scored.summary, null, 2));
    }
    return 0;
  }
  const check = checkEvaluationCorpus(corpus);
  deps.log(JSON.stringify(check, null, 2));
  return check.valid ? 0 : 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runEvaluationCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // Live provider exceptions are already replaced with fixed safe errors by the runner.
      console.error(
        error instanceof Error ? error.message : "Evaluation failed",
      );
      process.exitCode = 1;
    });
}
