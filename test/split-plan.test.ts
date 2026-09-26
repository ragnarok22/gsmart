import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryChanges,
  parseSplitPlan,
  renderSplitPlan,
  buildPlanPrompt,
} from "../src/utils/split-plan.ts";
import { DEFAULT_CONVENTIONS } from "../src/utils/conventions.ts";
import {
  commit,
  featureDiff,
  mixedCommits,
  mixedDiff,
} from "../test-support/split-plan-fixtures.ts";

test("mixed changes have stable hunk IDs, exact ranges and an indivisible lockfile", () => {
  const changes = inventoryChanges(mixedDiff);
  assert.deepEqual(
    changes.map((change) => change.id),
    ["f1.h1", "f1.h2", "f2.h1", "f3"],
  );
  assert.deepEqual(changes[0].hunk, {
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
  });
  assert.deepEqual(changes[1].hunk, {
    oldStart: 30,
    oldLines: 1,
    newStart: 30,
    newLines: 1,
  });
  assert.equal(changes[3].hunk, undefined);
  assert.equal(changes[3].kind, "lockfile");
  assert.deepEqual(inventoryChanges(mixedDiff), changes);
  const plan = parseSplitPlan(
    JSON.stringify({ commits: mixedCommits }),
    changes,
  );
  const rendered = renderSplitPlan(plan);
  assert.match(rendered, /3 proposed commit/);
  assert.match(rendered, /Depends on \[dependencies\]: Review retry behavior/);
  assert.match(rendered, /Manual splitting: "src\/retry.ts"/);
  assert.match(rendered, /4 change unit\(s\) assigned exactly once/);
});

test("a coherent change can be one commit, including valid multiline and breaking-change messages", () => {
  for (const message of [
    "fix: retry failures",
    "feat(api)!: change retries\n\nRetry requests three times.\n\nBREAKING CHANGE: failures are delayed.",
  ]) {
    const plan = parseSplitPlan(
      JSON.stringify({ commits: [commit("retry", ["f1.h1"], { message })] }),
      inventoryChanges(featureDiff),
    );
    assert.equal(plan.commits.length, 1);
    assert.match(renderSplitPlan(plan), /1 proposed commit/);
  }
});

test("structural, generated, binary and marker-less changes stay whole", () => {
  const patches = [
    "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/removed.ts b/removed.ts\ndeleted file mode 100644\n--- a/removed.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
    "diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..1111111\n",
    "diff --git a/foo b/image.bin b/foo b/image.bin\nindex 1111111..2222222 100644\nBinary files a/foo b/image.bin and b/foo b/image.bin differ\n",
    "diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n--- a/script.sh\n+++ b/script.sh\n@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/submodule b/submodule\nindex 1111111..2222222 160000\n--- a/submodule\n+++ b/submodule\n@@ -1 +1 @@\n-Subproject commit 1111111\n+Subproject commit 2222222\n",
    featureDiff.replaceAll("src/retry.ts", "generated/retry.ts"),
    "diff --git a/source b/copy\nsimilarity index 100%\ncopy from source\ncopy to copy\n",
  ];
  const changes = inventoryChanges(patches.join(""), {
    generated: ["generated/**"],
  });
  assert.equal(changes.length, 8);
  assert.ok(changes.every((change) => !change.hunk));
  assert.equal(changes[0].originalPath, "old.ts");
  assert.equal(changes[0].status, "renamed");
  assert.equal(changes[1].status, "deleted");
  assert.equal(changes[2].status, "added");
  assert.equal(changes[3].path, "foo b/image.bin");
  assert.equal(changes[3].kind, "binary");
  assert.equal(changes[6].kind, "generated");
  assert.equal(changes[7].status, "copied");
  assert.equal(changes[7].originalPath, "source");
  const plan = parseSplitPlan(
    JSON.stringify({
      commits: [
        commit(
          "all",
          changes.map((change) => change.id),
        ),
      ],
    }),
    changes,
  );
  assert.match(renderSplitPlan(plan), /from "old.ts"/);
  assert.match(renderSplitPlan(plan), /deleted, source; whole file/);
});

test("zero-length ranges, quoted paths and no-newline markers survive inventory", () => {
  const diff = `diff --git "a/line\\n\\t\\"file\\".ts" "b/line\\n\\t\\"file\\".ts"
--- "a/line\\n\\t\\"file\\".ts"
+++ "b/line\\n\\t\\"file\\".ts"
@@ -0,0 +1 @@
+new
\\ No newline at end of file
`;
  const [change] = inventoryChanges(diff);
  assert.equal(change.path, 'line\n\t"file".ts');
  assert.equal(change.hunk?.oldLines, 0);
  const rendered = renderSplitPlan({
    changes: [change],
    commits: [commit("one", [change.id])],
  });
  assert.ok(rendered.includes(JSON.stringify(change.path)));
});

test("excluded changes stay locally accounted for, never appearing in the AI inventory", () => {
  const changes = inventoryChanges(mixedDiff, { exclude: ["src/**"] });
  assert.equal(changes[0].id, "f1");
  assert.equal(changes[0].excluded, true);
  const plan = parseSplitPlan(
    JSON.stringify({ commits: [mixedCommits[0]] }),
    changes,
  );
  assert.match(renderSplitPlan(plan), /excluded from AI context/);
  assert.match(renderSplitPlan(plan), /1 excluded unit/);
  const prompt = buildPlanPrompt("main", changes, "prepared diff");
  assert.doesNotMatch(prompt.prompt, /src\/retry.ts|f1/);
  assert.match(prompt.prompt, /f2.h1/);
  const allExcluded = inventoryChanges(mixedDiff, { exclude: ["**"] });
  assert.match(
    renderSplitPlan(parseSplitPlan('{"commits":[]}', allExcluded)),
    /3 excluded unit/,
  );
});

test("exclusions apply to rename sources as well as destinations", () => {
  const changes = inventoryChanges(
    "diff --git a/private b/public\nsimilarity index 100%\nrename from private\nrename to public\n",
    { exclude: ["private"] },
  );
  assert.equal(changes[0].excluded, true);
  assert.doesNotMatch(
    buildPlanPrompt("main", changes, "").prompt,
    /private|public/,
  );
});

test("planner prompt preserves conventions/history and instructs uncertainty, coupling and manual splitting", () => {
  const prompt = buildPlanPrompt(
    "feature/498",
    inventoryChanges(mixedDiff),
    mixedDiff,
    {
      ...DEFAULT_CONVENTIONS,
      instructions: "Explain changes briefly.",
      language: "es",
      history: { enabled: true, limit: 1 },
    },
    ["fix(api): handle failures", "feat: second example"],
  );
  assert.match(prompt.system, /language es/);
  assert.match(prompt.system, /manifest.*lockfile/);
  assert.match(prompt.system, /one commit when changes are coherent/);
  assert.match(prompt.system, /manual splitting/);
  assert.match(prompt.system, /uncertainty and inseparability/);
  assert.match(prompt.prompt, /Explain changes briefly/);
  assert.match(prompt.prompt, /fix\(api\): handle failures/);
  assert.doesNotMatch(prompt.prompt, /second example/);
  assert.doesNotMatch(prompt.system, /Return ONLY the complete commit message/);
});

test("malformed schemas, invalid headers and missing/duplicate/invented accounting are rejected", () => {
  const changes = inventoryChanges(featureDiff);
  for (const response of [
    "",
    "```json\n{}\n```",
    "null",
    "[]",
    "{}",
    '{"commits":[]}',
    JSON.stringify({ commits: [commit("one", ["f1.h1"])], extra: true }),
    JSON.stringify({
      commits: [{ ...commit("one", ["f1.h1"]), files: ["made-up.ts"] }],
    }),
    ...[
      commit("one", []),
      commit("one", ["unknown"]),
      commit("one", ["f1.h1", "f1.h1"]),
      commit("one", ["f1.h1"], { message: "Here is the plan" }),
      commit("one", ["f1.h1"], { message: "feat: \u001b[31munsafe" }),
      commit("one", ["f1.h1"], { rationale: " " }),
      commit("one", ["f1.h1"], {
        dependencies: [{ commitId: "unknown", reason: "required" }],
      }),
      commit("one", ["f1.h1"], {
        dependencies: [{ commitId: "one", reason: "itself" }],
      }),
    ].map((item) => JSON.stringify({ commits: [item] })),
  ])
    assert.throws(() => parseSplitPlan(response, changes), /Invalid plan/);
  assert.throws(
    () =>
      parseSplitPlan(
        JSON.stringify({ commits: [mixedCommits[0]] }),
        inventoryChanges(mixedDiff),
      ),
    /missing change IDs f1.h1, f1.h2/,
  );
  assert.throws(() => inventoryChanges("not a Git diff"), /Cannot identify/);
});

test("duplicate commits, cross-group duplication, cycles and repeated dependencies are rejected", () => {
  for (const commits of [
    [commit("same", ["f1.h1"]), commit("same", ["f1.h2", "f2.h1", "f3"])],
    [
      commit("one", ["f1.h1"]),
      commit("two", ["f1.h1", "f1.h2", "f2.h1", "f3"]),
    ],
    [
      commit("one", ["f1.h1"], {
        dependencies: [{ commitId: "two", reason: "cycle" }],
      }),
      commit("two", ["f1.h2", "f2.h1", "f3"], {
        dependencies: [{ commitId: "one", reason: "cycle" }],
      }),
    ],
    [
      commit("one", ["f1.h1"]),
      commit("two", ["f1.h2", "f2.h1", "f3"], {
        dependencies: [
          { commitId: "one", reason: "first" },
          { commitId: "one", reason: "again" },
        ],
      }),
    ],
  ])
    assert.throws(
      () =>
        parseSplitPlan(
          JSON.stringify({ commits }),
          inventoryChanges(mixedDiff),
        ),
      /Invalid plan/,
    );
});

test("a type-change deletion/addition pair cannot be assigned to different commits", () => {
  const changes = inventoryChanges(
    "diff --git a/file b/file\ndeleted file mode 100644\nindex 1111111..0000000\ndiff --git a/file b/file\nnew file mode 120000\nindex 0000000..2222222\n",
  );
  assert.throws(
    () =>
      parseSplitPlan(
        JSON.stringify({
          commits: [commit("one", ["f1"]), commit("two", ["f2"])],
        }),
        changes,
      ),
    /coupled whole-file changes/,
  );
});

test("review output escapes paths and strips provider terminal controls", () => {
  const changes = inventoryChanges(featureDiff);
  const plan = parseSplitPlan(
    JSON.stringify({
      commits: [
        commit("one", ["f1.h1"], { rationale: "\u001b[2Jclear\u0007screen" }),
      ],
    }),
    changes,
  );
  assert.ok(!renderSplitPlan(plan).includes("\u001b"));
  assert.ok(!renderSplitPlan(plan).includes("\u0007"));
});
