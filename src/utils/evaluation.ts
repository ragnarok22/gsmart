import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommitConventions,
  EffectiveConventions,
  Provider,
} from "../definitions";
import type { ContextReport } from "./diff-context";
import { resolveConventions } from "./conventions";
import {
  normalizeCommitMessage,
  validateCommitMessage,
} from "./commit-message";
import { validateModel, validateProvider } from "./providers";
import { DEFAULT_TIMEOUT_MS } from "./constants";

export const DIMENSIONS = [
  "accuracy",
  "specificity",
  "typeScope",
  "breakingChanges",
  "unsupportedClaims",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
type Rating = {
  score: 0 | 1 | 2 | null;
  rationale: string;
  evidence: string[];
};
export type SemanticScores = Record<Dimension, Rating>;
export type EvaluationCase = {
  id: string;
  category: string;
  generation: { branch: string; conventions: CommitConventions; diff: string };
  scorer: {
    facts: { id: string; claim: string; evidence: string[] }[];
    types: string[];
    scopes: string[];
    breakingChange: boolean;
    unsupportedClaims: string[];
  };
};
export type EvaluationCorpus = {
  version: string;
  cases: EvaluationCase[];
  rubric: {
    version: string;
    dimensions: Record<Dimension, { "0": string; "1": string; "2": string }>;
  };
  syntax: {
    version: string;
    fixtures: { id: string; caseId: string; message: string; valid: boolean }[];
  };
};

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown, label: string): Record<string, unknown> {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(text);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** Canonical JSON hashes ignore object key order, but retain array order and text bytes. */
export function hashEvaluationData(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function effectiveCaseConventions(
  entry: EvaluationCase,
): EffectiveConventions {
  return resolveConventions([
    {
      source: `evaluation:${entry.id}`,
      settings: entry.generation.conventions,
    },
  ]);
}

/** Validate external JSON before either generation or scoring. Evidence is literal diff text. */
export function validateCorpus(
  value: unknown,
): asserts value is EvaluationCorpus {
  const corpus = object(value, "Corpus");
  requireValue(identifier(corpus.version), "Corpus needs a version");
  const rubric = object(corpus.rubric, "Rubric");
  requireValue(identifier(rubric.version), "Rubric needs a version");
  const dimensions = object(rubric.dimensions, "Rubric dimensions");
  requireValue(
    Object.keys(dimensions).length === DIMENSIONS.length,
    "Rubric must contain exactly five dimensions",
  );
  for (const dimension of DIMENSIONS) {
    const anchors = object(dimensions[dimension], dimension);
    requireValue(
      Object.keys(anchors).length === 3 &&
        ["0", "1", "2"].every((key) => text(anchors[key])),
      `${dimension} needs anchors 0, 1, 2`,
    );
  }
  requireValue(
    Array.isArray(corpus.cases) && corpus.cases.length >= 6,
    "Corpus needs at least six cases",
  );
  const ids = new Set<string>();
  const categories = new Set<string>();
  for (const raw of corpus.cases) {
    const entry = object(raw, "Case");
    requireValue(
      identifier(entry.id) && !ids.has(entry.id),
      "Case IDs must be unique safe identifiers",
    );
    ids.add(entry.id);
    requireValue(text(entry.category), `${entry.id}: missing category`);
    categories.add(entry.category);
    const generation = object(entry.generation, `${entry.id}: generation`);
    requireValue(
      Object.keys(generation).sort().join(",") === "branch,conventions,diff",
      `${entry.id}: unexpected generation fields`,
    );
    requireValue(
      text(generation.branch) &&
        text(generation.diff) &&
        generation.diff.startsWith("diff --git "),
      `${entry.id}: branch and Git diff required`,
    );
    object(generation.conventions, `${entry.id}: conventions`);
    const effective = effectiveCaseConventions(raw as EvaluationCase);
    requireValue(
      !effective.conventions.context.summarize,
      `${entry.id}: evaluation cases must disable paid summarization`,
    );
    const scorer = object(entry.scorer, `${entry.id}: scorer`);
    requireValue(
      strings(scorer.types) &&
        Array.isArray(scorer.scopes) &&
        scorer.scopes.every((scope) => typeof scope === "string"),
      `${entry.id}: expected types/scopes required`,
    );
    requireValue(
      typeof scorer.breakingChange === "boolean" &&
        strings(scorer.unsupportedClaims),
      `${entry.id}: breaking-change expectation and unsupported claims required`,
    );
    requireValue(
      Array.isArray(scorer.facts) && scorer.facts.length > 0,
      `${entry.id}: facts required`,
    );
    const factIds = new Set<string>();
    for (const rawFact of scorer.facts) {
      const fact = object(rawFact, `${entry.id}: fact`);
      requireValue(
        identifier(fact.id) && fact.id !== "diff" && !factIds.has(fact.id),
        `${entry.id}: fact IDs must be unique`,
      );
      factIds.add(fact.id);
      requireValue(
        text(fact.claim) && strings(fact.evidence),
        `${entry.id}: fact claim/evidence required`,
      );
      requireValue(
        fact.evidence.every((quote) =>
          (generation.diff as string).includes(quote),
        ),
        `${entry.id}: evidence not found in diff`,
      );
    }
  }
  for (const category of [
    "rename",
    "dependency-only",
    "breaking-change",
    "refactor",
    "deletion",
    "mixed",
  ])
    requireValue(
      categories.has(category),
      `Corpus missing category: ${category}`,
    );
  const syntax = object(corpus.syntax, "Syntax fixtures");
  requireValue(
    syntax.version === corpus.version &&
      Array.isArray(syntax.fixtures) &&
      syntax.fixtures.length >= 2,
    "Versioned syntax fixtures required",
  );
  const fixtureIds = new Set<string>();
  for (const raw of syntax.fixtures) {
    const fixture = object(raw, "Syntax fixture");
    requireValue(
      identifier(fixture.id) && !fixtureIds.has(fixture.id),
      "Syntax fixture IDs must be unique",
    );
    fixtureIds.add(fixture.id);
    requireValue(
      typeof fixture.caseId === "string" &&
        ids.has(fixture.caseId) &&
        typeof fixture.message === "string" &&
        typeof fixture.valid === "boolean",
      "Invalid syntax fixture",
    );
  }
  requireValue(
    syntax.fixtures.some((fixture) => fixture.valid) &&
      syntax.fixtures.some((fixture) => !fixture.valid),
    "Syntax fixtures must include valid and invalid messages",
  );
}

export async function loadEvaluationCorpus(
  directory: string,
): Promise<EvaluationCorpus> {
  const readJSON = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(directory, name), "utf8"));
  const manifest = object(await readJSON("cases.json"), "Manifest");
  requireValue(Array.isArray(manifest.cases), "Manifest cases required");
  const cases = await Promise.all(
    manifest.cases.map(async (raw) => {
      const entry = object(raw, "Case");
      requireValue(identifier(entry.id), "Case ID must be a safe identifier");
      const generation = object(entry.generation, "Generation");
      requireValue(
        !("diff" in generation),
        "Diff must be stored in the case's .diff file",
      );
      return {
        ...entry,
        generation: {
          ...generation,
          diff: await readFile(join(directory, `${entry.id}.diff`), "utf8"),
        },
      };
    }),
  );
  const corpus = {
    version: manifest.version,
    cases,
    rubric: await readJSON("rubric.json"),
    syntax: await readJSON("syntax.json"),
  };
  validateCorpus(corpus);
  return corpus;
}

export function checkEvaluationCorpus(corpus: EvaluationCorpus) {
  validateCorpus(corpus);
  const fixtures = corpus.syntax.fixtures.map((fixture) => {
    const entry = corpus.cases.find((entry) => entry.id === fixture.caseId)!;
    const syntax = validateCommitMessage(
      fixture.message,
      effectiveCaseConventions(entry),
    );
    return {
      id: fixture.id,
      expectedValid: fixture.valid,
      ...syntax,
      passed: syntax.valid === fixture.valid,
    };
  });
  return {
    valid: fixtures.every((fixture) => fixture.passed),
    cases: corpus.cases.length,
    corpusHash: hashEvaluationData(corpus),
    rubricHash: hashEvaluationData(corpus.rubric),
    fixtures,
  };
}

type SyntaxResult = ReturnType<typeof validateCommitMessage>;
export type SourceRevision = { revision: string | null; dirty: boolean | null };
export type EvaluationRequest = {
  provider: Provider;
  model: string;
  branch: string;
  diff: string;
  conventions: EffectiveConventions["conventions"];
  onPromptPrepared: (request: { system: string; prompt: string }) => void;
  onContextPrepared: (report: ContextReport) => void;
};
export type EvaluationGenerator = (
  request: EvaluationRequest,
) => Promise<string | { error: string; code?: string }>;
type SafeError = {
  code: string;
  stage: "setup" | "generation" | "instrumentation";
  message: string;
};
export type EvaluationSample = {
  id: string;
  caseId: string;
  run: number;
  request: {
    effectiveConventions: EffectiveConventions;
    promptHash: string | null;
  };
  contextReport: ContextReport | null;
  output: string | null;
  normalizedOutput: string | null;
  outputHash: string | null;
  syntax: SyntaxResult | null;
  error: SafeError | null;
  semantic: SemanticScores;
};
export type EvaluationReport = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  metadata: {
    provider: Provider;
    model: string;
    runs: number;
    promptVersion: string;
    corpus: { version: string; hash: string };
    rubric: { version: string; hash: string };
    source: SourceRevision;
    transportAttempts: 1;
    timeoutMs: number;
  };
  samples: EvaluationSample[];
  summary: ReturnType<typeof summarizeEvaluation>;
};

export function emptySemanticScores(): SemanticScores {
  const empty = (): Rating => ({ score: null, rationale: "", evidence: [] });
  return {
    accuracy: empty(),
    specificity: empty(),
    typeScope: empty(),
    breakingChanges: empty(),
    unsupportedClaims: empty(),
  };
}

const SAFE_ERRORS: Record<string, string> = {
  AUTHENTICATION: "Provider authentication failed; inspect local credentials.",
  CONFIGURATION: "Provider or model configuration failed.",
  CONTEXT: "Context preparation failed.",
  CANCELED: "Generation was canceled.",
  GENERATION: "Generation failed; raw provider error omitted.",
};
function safeError(code: unknown, stage: SafeError["stage"]): SafeError {
  const safeCode =
    typeof code === "string" && Object.hasOwn(SAFE_ERRORS, code)
      ? code
      : "GENERATION";
  return { code: safeCode, stage, message: SAFE_ERRORS[safeCode] };
}

export type LiveEvaluationOptions = {
  live?: boolean;
  provider?: string;
  model?: string;
  runs?: number;
  source?: SourceRevision;
};

/** Match AIBuilder's timeout resolution without reading environment or credentials. */
export function resolveEvaluationTimeout(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function validateLiveOptions(options: LiveEvaluationOptions) {
  requireValue(
    options.live === true,
    "Live evaluation requires explicit --live opt-in",
  );
  requireValue(
    text(options.provider) && text(options.model),
    "Live evaluation requires explicit --provider and --model",
  );
  const provider = validateProvider(options.provider);
  const model = validateModel(options.model);
  const runs = options.runs ?? 3;
  requireValue(
    Number.isSafeInteger(runs) && runs >= 1 && runs <= 100,
    "--runs must be an integer from 1 to 100",
  );
  return { provider, model, runs };
}

/** One generation per case/run. No quality retries, cherry-picking or semantic judging. */
export async function runEvaluation(
  corpus: EvaluationCorpus,
  options: LiveEvaluationOptions,
  deps: {
    loadGenerator: () => Promise<EvaluationGenerator>;
    promptVersion: string;
    /** Effective transport setting supplied by the live CLI; defaults for injected runners. */
    timeoutMs?: number;
    now?: () => Date;
    createId?: () => string;
  },
): Promise<EvaluationReport> {
  const { provider, model, runs } = validateLiveOptions(options);
  const check = checkEvaluationCorpus(corpus);
  requireValue(
    check.valid,
    "Fix failing syntax fixtures before live evaluation",
  );
  requireValue(text(deps.promptVersion), "Prompt version is required");
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  requireValue(
    Number.isFinite(timeoutMs) && timeoutMs > 0,
    "Timeout must be a positive finite number",
  );
  const id = (deps.createId ?? randomUUID)();
  const samples: EvaluationSample[] = [];
  let generate: EvaluationGenerator | undefined;
  try {
    generate = await deps.loadGenerator();
  } catch {
    /* Retain setup failure for every requested sample. */
  }
  for (const entry of corpus.cases) {
    for (let run = 1; run <= runs; run++) {
      const effective = effectiveCaseConventions(entry);
      const sample: EvaluationSample = {
        id: `${id}:${entry.id}:${run}`,
        caseId: entry.id,
        run,
        request: { effectiveConventions: effective, promptHash: null },
        contextReport: null,
        output: null,
        normalizedOutput: null,
        outputHash: null,
        syntax: null,
        error: null,
        semantic: emptySemanticScores(),
      };
      samples.push(sample);
      if (!generate) {
        sample.error = safeError(undefined, "setup");
        continue;
      }
      try {
        // Deliberate projection: scorer facts, acceptable types and claims never cross this boundary.
        const result = await generate({
          provider,
          model,
          branch: entry.generation.branch,
          diff: entry.generation.diff,
          conventions: structuredClone(effective.conventions),
          onPromptPrepared: (request) => {
            sample.request.promptHash = hashEvaluationData({
              system: request.system,
              prompt: request.prompt,
            });
          },
          onContextPrepared: (report) => {
            sample.contextReport = structuredClone(report);
          },
        });
        if (typeof result !== "string") {
          sample.error = safeError(result.code, "generation");
          continue;
        }
        sample.output = result;
        sample.outputHash = hashEvaluationData(result);
        sample.normalizedOutput = normalizeCommitMessage(result);
        sample.syntax = validateCommitMessage(
          sample.normalizedOutput,
          effective,
        );
        if (!sample.request.promptHash)
          sample.error = {
            code: "INSTRUMENTATION",
            stage: "instrumentation",
            message:
              "No prepared prompt was observed; prompt hash is unavailable.",
          };
      } catch {
        sample.error = safeError(undefined, "generation");
      }
    }
  }
  return {
    schemaVersion: 1,
    id,
    createdAt: (deps.now ?? (() => new Date()))().toISOString(),
    metadata: {
      provider,
      model,
      runs,
      promptVersion: deps.promptVersion,
      corpus: { version: corpus.version, hash: check.corpusHash },
      rubric: { version: corpus.rubric.version, hash: check.rubricHash },
      source: options.source ?? { revision: null, dirty: null },
      transportAttempts: 1,
      timeoutMs,
    },
    samples,
    summary: summarizeEvaluation(samples),
  };
}

export function summarizeEvaluation(samples: EvaluationSample[]) {
  const aggregate = (group: EvaluationSample[]) => {
    const outputs = group.filter((sample) => sample.output !== null);
    const scored = outputs.filter((sample) =>
      DIMENSIONS.every(
        (dimension) => sample.semantic[dimension].score !== null,
      ),
    );
    return {
      total: group.length,
      generated: outputs.length,
      generationFailures: group.length - outputs.length,
      otherErrors: outputs.filter((sample) => sample.error !== null).length,
      syntaxValid: outputs.filter((sample) => sample.syntax?.valid).length,
      syntaxInvalid: outputs.filter(
        (sample) => sample.syntax && !sample.syntax.valid,
      ).length,
      scored: scored.length,
      unscored: outputs.length - scored.length,
      distinctOutputs: new Set(outputs.map((sample) => sample.outputHash)).size,
      dimensions: Object.fromEntries(
        DIMENSIONS.map((dimension) => {
          const scores = scored.map(
            (sample) => sample.semantic[dimension].score!,
          );
          return [
            dimension,
            {
              count: scores.length,
              mean: scores.length
                ? scores.reduce<number>((sum, score) => sum + score, 0) /
                  scores.length
                : null,
              min: scores.length ? Math.min(...scores) : null,
              max: scores.length ? Math.max(...scores) : null,
              distribution: {
                "0": scores.filter((score) => score === 0).length,
                "1": scores.filter((score) => score === 1).length,
                "2": scores.filter((score) => score === 2).length,
              },
            },
          ];
        }),
      ),
    };
  };
  return {
    overall: aggregate(samples),
    byCase: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.caseId))]
        .sort()
        .map((id) => [
          id,
          aggregate(samples.filter((sample) => sample.caseId === id)),
        ]),
    ),
  };
}

function validateScores(
  value: unknown,
  entry: EvaluationCase,
): asserts value is SemanticScores {
  const scores = object(value, "Scores");
  requireValue(
    Object.keys(scores).length === DIMENSIONS.length,
    "Scores must contain exactly five dimensions",
  );
  const unscored = DIMENSIONS.every(
    (dimension) => object(scores[dimension], dimension).score === null,
  );
  const references = new Set([
    "diff",
    ...entry.scorer.facts.map((fact) => fact.id),
  ]);
  for (const dimension of DIMENSIONS) {
    const rating = object(scores[dimension], dimension);
    if (unscored) {
      requireValue(
        rating.rationale === "" &&
          Array.isArray(rating.evidence) &&
          !rating.evidence.length,
        "Unscored ratings must have empty rationale/evidence",
      );
    } else {
      requireValue(
        rating.score === 0 || rating.score === 1 || rating.score === 2,
        "Scores must be integers 0..2; score all five dimensions together",
      );
      requireValue(
        text(rating.rationale) && strings(rating.evidence),
        "Each score needs human rationale and evidence references",
      );
      requireValue(
        rating.evidence.every((reference) => references.has(reference)),
        "Unknown evidence reference; use case fact IDs or diff",
      );
    }
  }
}

/** Recheck output identities and corpus before accepting an externally edited report. */
export function validateEvaluationReport(
  value: unknown,
  corpus: EvaluationCorpus,
): asserts value is EvaluationReport {
  validateCorpus(corpus);
  const report = object(value, "Report");
  requireValue(
    report.schemaVersion === 1 && text(report.id) && text(report.createdAt),
    "Unsupported report format",
  );
  const metadata = object(report.metadata, "Report metadata");
  requireValue(
    object(metadata.corpus, "Corpus metadata").hash ===
      hashEvaluationData(corpus) &&
      object(metadata.rubric, "Rubric metadata").hash ===
        hashEvaluationData(corpus.rubric),
    "Report corpus/rubric hashes do not match; select the original corpus",
  );
  requireValue(
    object(metadata.corpus, "Corpus metadata").version === corpus.version &&
      object(metadata.rubric, "Rubric metadata").version ===
        corpus.rubric.version,
    "Report version mismatch",
  );
  requireValue(
    text(metadata.provider) &&
      text(metadata.model) &&
      text(metadata.promptVersion),
    "Missing request metadata",
  );
  const { runs } = validateLiveOptions({
    live: true,
    provider: metadata.provider,
    model: metadata.model,
    runs: metadata.runs as number,
  });
  requireValue(
    metadata.runs === runs && metadata.transportAttempts === 1,
    "Invalid run metadata",
  );
  requireValue(
    typeof metadata.timeoutMs === "number" &&
      Number.isFinite(metadata.timeoutMs) &&
      metadata.timeoutMs > 0,
    "Invalid timeout metadata",
  );
  const source = object(metadata.source, "Source revision");
  requireValue(
    (source.revision === null || typeof source.revision === "string") &&
      (source.dirty === null || typeof source.dirty === "boolean"),
    "Invalid source revision",
  );
  requireValue(
    Array.isArray(report.samples) &&
      report.samples.length === corpus.cases.length * runs,
    "Report must retain every case/run slot",
  );
  const ids = new Set<string>();
  for (const raw of report.samples) {
    const sample = object(raw, "Sample");
    const entry = corpus.cases.find((entry) => entry.id === sample.caseId);
    requireValue(
      entry &&
        Number.isInteger(sample.run) &&
        (sample.run as number) >= 1 &&
        (sample.run as number) <= runs,
      "Unknown case/run",
    );
    requireValue(
      sample.id === `${report.id}:${entry.id}:${sample.run}` &&
        !ids.has(sample.id as string),
      "Invalid or duplicate sample ID",
    );
    ids.add(sample.id as string);
    const request = object(sample.request, "Sample request");
    const effective = effectiveCaseConventions(entry);
    requireValue(
      hashEvaluationData(request.effectiveConventions) ===
        hashEvaluationData(effective),
      "Effective conventions do not match case",
    );
    requireValue(
      request.promptHash === null || hash(request.promptHash),
      "Invalid prompt hash",
    );
    requireValue(
      sample.error === null ||
        (text(object(sample.error, "Sample error").code) &&
          text(object(sample.error, "Sample error").message)),
      "Invalid sample error",
    );
    if (sample.output === null) {
      requireValue(
        sample.outputHash === null &&
          sample.normalizedOutput === null &&
          sample.syntax === null &&
          sample.error !== null,
        "Generation failure must retain error and null output",
      );
    } else {
      requireValue(
        typeof sample.output === "string" &&
          sample.outputHash === hashEvaluationData(sample.output),
        "Output hash mismatch",
      );
      requireValue(
        typeof sample.normalizedOutput === "string" &&
          sample.normalizedOutput === normalizeCommitMessage(sample.output),
        "Normalized output mismatch",
      );
      requireValue(
        hashEvaluationData(sample.syntax) ===
          hashEvaluationData(
            validateCommitMessage(sample.normalizedOutput, effective),
          ),
        "Syntax diagnostics mismatch",
      );
      requireValue(
        request.promptHash !== null || sample.error !== null,
        "Missing prompt hash must be recorded as an error",
      );
    }
    validateScores(sample.semantic, entry);
    const semantic = sample.semantic;
    requireValue(
      sample.output !== null ||
        DIMENSIONS.every((dimension) => semantic[dimension].score === null),
      "Generation failures cannot receive semantic scores",
    );
  }
}

export function annotationTemplate(report: unknown, corpus: EvaluationCorpus) {
  validateEvaluationReport(report, corpus);
  return {
    schemaVersion: 1,
    reportId: report.id,
    corpusHash: report.metadata.corpus.hash,
    rubricHash: report.metadata.rubric.hash,
    samples: report.samples
      .filter((sample) => sample.output !== null)
      .map((sample) => ({
        sampleId: sample.id,
        outputHash: sample.outputHash,
        scores: emptySemanticScores(),
      })),
  };
}

export function applyAnnotations(
  report: unknown,
  value: unknown,
  corpus: EvaluationCorpus,
): EvaluationReport {
  validateEvaluationReport(report, corpus);
  const annotations = object(value, "Annotations");
  requireValue(
    annotations.schemaVersion === 1 &&
      annotations.reportId === report.id &&
      annotations.corpusHash === report.metadata.corpus.hash &&
      annotations.rubricHash === report.metadata.rubric.hash,
    "Annotations do not match report/corpus/rubric identity",
  );
  requireValue(
    Array.isArray(annotations.samples),
    "Annotation samples required",
  );
  const result = structuredClone(report);
  const seen = new Set<string>();
  for (const raw of annotations.samples) {
    const annotation = object(raw, "Annotation");
    const sample = result.samples.find(
      (sample) => sample.id === annotation.sampleId,
    );
    requireValue(
      sample && !seen.has(sample.id),
      "Unknown or duplicate annotation sample ID",
    );
    seen.add(sample.id);
    requireValue(
      sample.output !== null && annotation.outputHash === sample.outputHash,
      "Annotation output hash mismatch or generation failure",
    );
    const entry = corpus.cases.find((entry) => entry.id === sample.caseId)!;
    validateScores(annotation.scores, entry);
    const scores = annotation.scores;
    // Blank template entries remain unscored and do not erase an earlier review.
    if (DIMENSIONS.every((dimension) => scores[dimension].score !== null))
      sample.semantic = structuredClone(scores);
  }
  result.summary = summarizeEvaluation(result.samples);
  return result;
}
