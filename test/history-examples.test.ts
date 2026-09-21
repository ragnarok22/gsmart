import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  git,
  repository,
  temporaryDirectory,
} from "../test-support/repository.ts";
import {
  boundHistoryExamples,
  getRecentCommitSubjects,
} from "../src/utils/git.ts";
import { buildCommitPrompt } from "../src/utils/commit-prompt.ts";
import { resolveConventions } from "../src/utils/conventions.ts";

test("history is newest-first, subject-only, and bounded by count", async (t) => {
  const root = repository(t);
  for (let i = 0; i < 4; i++)
    git(
      root,
      "commit",
      "--allow-empty",
      "-qm",
      `feat: subject ${i}\n\nBody must not be included ${i}`,
    );
  assert.deepEqual(await getRecentCommitSubjects(root, 2), [
    "feat: subject 3",
    "feat: subject 2",
  ]);
  assert.deepEqual(await getRecentCommitSubjects(root, 0), []);
});

test("history ignores merge subjects", async (t) => {
  const root = repository(t);
  git(root, "commit", "--allow-empty", "-qm", "chore: initial");
  git(root, "checkout", "-qb", "feature");
  git(root, "commit", "--allow-empty", "-qm", "feat: branch");
  git(root, "checkout", "-q", "main");
  git(root, "merge", "--no-ff", "feature", "-qm", "Merge must not be included");
  assert.deepEqual(await getRecentCommitSubjects(root, 5), [
    "feat: branch",
    "chore: initial",
  ]);
});

test("unborn repositories provide no history, and invalid counts fail clearly", async (t) => {
  const root = repository(t);
  assert.deepEqual(await getRecentCommitSubjects(root, 5), []);
  for (const count of [-1, 21, 1.5, NaN])
    await assert.rejects(getRecentCommitSubjects(root, count), /0 to 20/);
});

test("very large Git subjects are drained without contaminating following examples", async (t) => {
  const root = repository(t);
  git(root, "commit", "--allow-empty", "-qm", "fix: smaller subject");
  const message = join(temporaryDirectory(t), "message");
  writeFileSync(message, `feat: ${"x".repeat(250_000)}\n\nBody excluded`);
  git(root, "commit", "--allow-empty", "-qF", message);
  const examples = await getRecentCommitSubjects(root, 5);
  assert.equal(examples[0].length, 200);
  assert.equal(examples[1], "fix: smaller subject");
});

test("prompt history has hard bounds even for directly supplied examples", () => {
  const examples = boundHistoryExamples(
    Array.from({ length: 30 }, () => "x".repeat(500)),
  );
  assert.equal(examples.length, 20);
  assert.equal(examples.join("").length, 4000);
  assert.deepEqual(
    boundHistoryExamples(["\u001b[31mfeat: test\u001b[0m\nbody"]),
    ["feat: test body"],
  );
  const { conventions } = resolveConventions([
    { source: "test", settings: { history: { enabled: true, limit: 2 } } },
  ]);
  const [, prompt] = buildCommitPrompt("main", "diff", conventions, examples);
  assert.equal(
    prompt.split("\n").filter((line) => line.startsWith('"')).length,
    2,
  );
});
