import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { repository, git } from "../test-support/repository.ts";
import { getGitChanges, getStagedSnapshot } from "../src/utils/git.ts";
import { prepareContext } from "../src/utils/diff-context.ts";
import { resolveContextBudget } from "../src/utils/context-budget.ts";

test("multi-megabyte staged diffs are captured and preparation preserves index and worktree", async (t) => {
  const root = repository(t);
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  process.chdir(root);
  writeFileSync(join(root, "renamed from.txt"), "original\n");
  writeFileSync(join(root, "deleted.txt"), "removed\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  renameSync(join(root, "renamed from.txt"), join(root, "renamed to.txt"));
  rmSync(join(root, "deleted.txt"));
  const staged = Array.from(
    { length: 50000 },
    (_, i) =>
      `export const item${i} = "handle retries without losing response bodies";\n`,
  ).join("");
  writeFileSync(join(root, "huge.ts"), staged);
  writeFileSync(join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
  git(root, "add", ".");
  writeFileSync(
    join(root, "huge.ts"),
    staged + "// Unstaged work must remain private\n",
  );
  const beforeIndex = readFileSync(join(root, ".git/index"));
  const beforeWorktree = readFileSync(join(root, "huge.ts"));
  const raw = execFileSync("git", ["diff", "--cached", "--full-index"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ok(Buffer.byteLength(raw) > 2 * 1024 * 1024);
  const diff = await getGitChanges();
  assert.ok(
    diff.includes("item49999"),
    "capture must not return an empty or truncated diff",
  );
  assert.equal(diff, raw);
  const snapshot = await getStagedSnapshot();
  assert.equal(snapshot.diff, raw);
  const result = await prepareContext({
    diff: snapshot.diff,
    budget: resolveContextBudget("custom", "local"),
    buildPrompt: (changes) => ({
      system: "Generate a grounded commit message.",
      prompt: changes,
    }),
  });
  assert.match(result.prompt, /renamed from.txt/);
  assert.match(result.prompt, /deleted/);
  assert.match(result.prompt, /binary/i);
  assert.doesNotMatch(result.prompt, /Unstaged work/);
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(readFileSync(join(root, ".git/index"))), hash(beforeIndex));
  assert.deepEqual(readFileSync(join(root, "huge.ts")), beforeWorktree);
  assert.deepEqual(await getStagedSnapshot(), snapshot);
});
