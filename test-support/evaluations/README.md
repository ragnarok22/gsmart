# Commit-message evaluation

This developer harness measures two different things: deterministic commit-message
syntax and human-reviewed semantic quality. There is no AI judge, reference-message
string matching, or automatic semantic pass/fail threshold.

## Commands

From the repository root, after installing dependencies:

```sh
pnpm run eval
pnpm run eval --check
```

Both commands are **offline**. They validate corpus structure, conventions, unique
IDs, required categories, evidence quotes, rubric anchors, and the syntax fixtures
using the same validator as generation. They do not import AIBuilder, open the
credential store, resolve user/repository configuration, or contact a provider.
Syntax fixtures include intentionally invalid messages; the check passes when
each result matches its declared expectation. Corpus tests also check that Git
can parse every patch.

Live generation requires explicit opt-in, provider, model, and a new output file:

```sh
pnpm run eval --live --provider openai --model gpt-4o-mini --runs 3 --output report.json
```

Choose the model you intend to evaluate; the example is not a model recommendation.
The harness calls the existing AIBuilder with that explicit provider/model and
uses the existing local credentials (including supported OAuth/custom endpoint
configuration). Run the normal `gsmart login` or configuration workflow beforehand.
Provider/model defaults are never silently selected. `--runs` defaults to 3 and
accepts integers from 1 through 100. Calls are sequential.

The effective request timeout is recorded as `metadata.timeoutMs`: a positive,
finite numeric `GSMART_TIMEOUT` value in milliseconds, otherwise
`DEFAULT_TIMEOUT_MS` (currently 30,000 ms). Resolution matches AIBuilder. The CLI
captures this setting before generation; offline checking/scoring does not read
the runtime timeout or change recorded settings.

**Live calls may cost money.** Six cases × three runs means 18 generation attempts.
These small fixtures disable context summarization; the adapter allows one
transport attempt per sample. There are no regeneration loops, quality retries,
or filtering of failed samples. Authentication and generation errors occupy their
original sample slots. Nonconforming output is retained with syntax diagnostics.
Live mode writes the report and exits 1 if any generation, instrumentation, or
syntax failure occurs. All-successful generation exits 0 even though human scores
are still unscored. Offline corpus errors/check failures exit 1.

Reports and annotation files are local artifacts. All output modes refuse to
overwrite existing files. Prefer a scratch directory outside the repository for
large comparisons, and never add credential files to this corpus.

## Human scoring (offline)

Generate a template from a saved report:

```sh
pnpm run eval --template report.json --output annotations.json
```

Read each output alongside its case diff, branch, conventions, and scorer facts
in `v1/cases.json`. Edit the annotation entries you want to review, for example:

```json
{
  "score": 2,
  "rationale": "Names the internal helper rename and import adjustment without claiming behavior changes.",
  "evidence": ["rename", "import"]
}
```

This is one dimension's rating, not a complete annotation document. Keep the
template's schema version, report ID, corpus/rubric hashes, sample IDs and output
hashes unchanged. Fill **all five dimensions** for a reviewed sample with integer
scores 0, 1, or 2, a nonempty human rationale, and evidence references. References
are case fact IDs, or `"diff"` for observations about the complete patch (including
the absence of a claimed change). Rationale should explain the evidence's bearing
on that dimension rather than merely repeat the numeric score.

Leave an unreviewed sample's five scores `null`, rationales empty, and evidence
arrays empty, or remove its annotation entry. Null is unscored, not zero. Failed
generation has no output to score and is excluded from templates. Syntactically
invalid output remains reviewable. Empty-string output also remains reviewable;
reviewers should rate it based on missing content, rather than treating it as a
transport failure.

Ingest the annotations without any network access:

```sh
pnpm run eval --score report.json --annotations annotations.json --output scored.json
```

Scoring rejects stale output hashes, unknown/duplicate samples, changed corpus or
rubric identity, out-of-range or partial ratings, and missing/unknown evidence.
The original report remains intact. You can score a previously scored report to
add reviews or replace ratings for specified samples; blank template entries do
not erase earlier reviews. The human rationale remains in each sample's
`semantic` field. Keep reviewer names/adjudication notes in your review process if
multiple people review the same outputs; this initial harness does not implement
inter-rater consensus.

## Rubric anchors

The authoritative machine-readable anchors are `v1/rubric.json`. Each dimension
is scored independently from 0 to 2; a higher score is better.

| Dimension           | 0                                             | 1                                                            | 2                                                                   |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `accuracy`          | Central change wrong or contradicted          | Recognizable change, material omission/misstatement          | Material change and impact accurately conveyed                      |
| `specificity`       | Generic “update code”                         | Identifies area/action, misses distinguishing detail         | Concrete behavior/symbol/action and relevant mixed changes          |
| `typeScope`         | Misleading type/scope or convention violation | Defensible but unnecessarily broad                           | Type/scope match evidence and conventions                           |
| `breakingChanges`   | Misses a real break or invents one            | Recognizes break, misses impact/migration or required marker | Correct compatibility assessment; explains real break and migration |
| `unsupportedClaims` | Substantial invented claim                    | Minor ungrounded inference/motivation                        | Every substantive claim grounded in evidence                        |

For non-breaking cases, correctly avoiding a breaking claim earns 2 in
`breakingChanges`. A dependency update alone does not prove security remediation
or a speedup. An extracted predicate does not prove a bug fix. Removing a CI job
does not by itself change the package's runtime compatibility guarantee. The
mixed case should prioritize the zero-TTL fix and mention the independent docs
change concisely in its required body. For the breaking case, identify the
incompatible string-to-options signature and how a caller migrates.

Acceptable types/scopes and unsupported-claim examples are scorer guidance, not
exhaustive allow/deny lists. Several phrasings can be equally good. Score against
the actual diff rather than requiring a particular generated sentence.

## Corpus and prompt separation

`v1/` includes six synthetic, realistic Git patches: a rename with an import
update, a dependency-only update, an exported API break, a behavior-preserving
refactor, deletion of a scheduled CI workflow, and mixed code/test/docs changes.
Each `cases.json` entry has:

- `generation`: branch and structured conventions; `<case-id>.diff` supplies the
  patch. Only these inputs are passed into generation.
- `scorer`: fact IDs and literal evidence quotes, acceptable types/scopes, a
  breaking-change expectation, and examples of unsupported claims. These are
  never included in the model request.

`syntax.json` contains independent valid/invalid syntax fixtures. They are not
reference answers or few-shot examples and are never passed to the model. The
same applies to rubric anchors and human annotations.

## Metadata, hashes and versioning

Report `schemaVersion` is 1. Shared `metadata` applies to every sample and records
provider/model, run count, prompt version, corpus/rubric versions and hashes,
effective timeout, one-attempt transport policy, and source Git revision/dirty state when available.
Unknown source fields are `null`. A dirty tree is deliberately reported so a
comparison can distinguish uncommitted prompt/code changes; the revision alone
cannot reproduce a dirty working tree.

Each sample contains resolved conventions **including setting sources and rule
metadata**, the actual prepared prompt hash, context report, original output,
normalized output, output hash, syntax diagnostics, safe error, and semantic
ratings. `onPromptPrepared` hashes the final system/prompt supplied to AIBuilder's
transport, after context preparation and additional instructions; it does not
hash a guessed/reconstructed request. Prompts themselves are not stored. A
failure before preparation has a null prompt hash/context report; successful
output without the callback is an explicit instrumentation error. Raw SDK
exceptions, credential values, endpoint authentication details, and error stacks
are never serialized. Errors use fixed safe categories/messages.

Hashes are lowercase SHA-256 over canonical JSON: object keys sorted recursively,
array order retained, strings preserved exactly. The output hash hashes the JSON
encoding of the **original** output string, before normalization. The prompt hash
hashes `{ "system": ..., "prompt": ... }`. The corpus hash covers version,
fully loaded cases (including diff bytes and scorer data), rubric, and syntax
fixtures. The rubric also has its own hash. Cosmetic JSON key ordering does not
change identity, but changes to diff text, facts or anchors do.

Treat published corpus/rubric versions as immutable. Copy into `v2/` for changes
to cases, evidence, expectations, syntax fixtures, or rubric anchors; update the
corpus/syntax versions together and bump the rubric version when anchors change.
Use `--corpus test-support/evaluations/v2` with any mode. Scoring an older report
requires its original corpus. The shared `COMMIT_PROMPT_VERSION` should change
when prompt behavior changes; the actual request hash also detects text changes
within a version. Changes to report/annotation contracts require a schema bump.

Scoring also rechecks normalization, syntax diagnostics, and resolved conventions.
If those implementations or built-in defaults have changed since generation,
use the recorded source revision to score the old report. This keeps syntax
comparisons tied to the same deterministic rules.

## Comparing nondeterministic runs

Compare reports with the same corpus/rubric hashes and review coverage. Check
provider/model, prompt version/hash, effective conventions, timeout, source state
and context reduction before attributing a difference to a model or prompt. Mutable
model aliases may change remotely even if the model string does not.

For a compact comparison, inspect each report's `metadata` and `summary` fields.
Report/sample IDs and timestamps intentionally differ between runs. Context
reports record token budgets and actual reduction; effective conventions retain
configured context/output settings. Authentication mode and custom endpoint
details are not recorded, so keep them consistent when comparing the same
provider/model label.

`summary.overall` and stable-key `summary.byCase` include requested/generated
counts, generation failures, other errors, syntax-valid/invalid counts,
scored/unscored counts, and distinct output hashes. Each semantic dimension has
count, mean, min/max and a 0/1/2 distribution. Means use **only reviewed outputs**;
generation failures are not silently converted to zero or dropped from failure
counts. No weighted composite hides tradeoffs between dimensions. Summaries are
recomputed on ingestion rather than trusting edited aggregates.

Three runs expose some variability, not statistical significance. Different text
can be equally correct, and identical text can be consistently wrong. Review all
runs, especially failures; avoid selecting only the best candidate. Report raw
counts and score ranges, review coverage and failure rates alongside means.
Changes on a six-case corpus are directional evidence, not a broad quality claim.
