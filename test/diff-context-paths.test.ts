import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDiffFiles, prepareContext } from "../src/utils/diff-context.ts";
import { resolveContextBudget } from "../src/utils/context-budget.ts";
import { git, repository } from "../test-support/repository.ts";

const cases = [
  {
    path: "foo b/bar.bin",
    headers:
      "index 1111111..2222222 100644\nBinary files a/foo b/bar.bin and b/foo b/bar.bin differ\n",
    kind: "binary",
    change: "modified",
  },
  {
    path: "added b/new.bin",
    headers:
      "new file mode 100644\nindex 0000000..2222222\nBinary files /dev/null and b/added b/new.bin differ\n",
    kind: "binary",
    change: "added",
  },
  {
    path: "deleted b/old.bin",
    headers:
      "deleted file mode 100644\nindex 1111111..0000000\nBinary files a/deleted b/old.bin and /dev/null differ\n",
    kind: "binary",
    change: "deleted",
  },
  {
    path: "scripts b/nested b/run.sh",
    headers: "old mode 100644\nnew mode 100755\n",
    kind: "source",
    change: "modified",
  },
] as const;

for (const { path, headers, kind, change } of cases) {
  test(`marker-less ${change} ${kind} changes retain the full path: ${path}`, async () => {
    const diff = `diff --git a/${path} b/${path}\n${headers}`;
    const [file] = parseDiffFiles(diff);
    assert.equal(file.path, path);
    assert.equal(file.originalPath, undefined);
    assert.equal(file.kind, kind);
    assert.ok(file.metadata.includes(`File: ${JSON.stringify(path)}`));
    assert.ok(file.metadata.includes(`Change: ${change};`));

    const result = await prepareContext({
      diff,
      budget: resolveContextBudget("custom", "local"),
      buildPrompt: (changes) => ({ system: "", prompt: changes }),
    });
    assert.equal(result.report.files[0].path, path);
    assert.equal(result.prompt, diff);
    await assert.rejects(
      prepareContext({
        diff,
        budget: resolveContextBudget("custom", "local", { exclude: [path] }),
        buildPrompt: (changes) => ({ system: "", prompt: changes }),
      }),
      /No usable AI context/,
    );
  });
}

test("real staged binary and mode-only paths honor exclusions without changing the index or worktree", async (t) => {
  const root = repository(t);
  const modified = "foo b/bar.bin";
  const added = "added b/file and b/extra.bin";
  const deleted = "deleted b/old.bin";
  const modeOnly = "scripts b/nested b/run.sh";
  const paths = [modified, added, deleted, modeOnly];
  for (const path of paths)
    mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, modified), Buffer.from([0, 1, 2]));
  writeFileSync(join(root, deleted), Buffer.from([0, 3, 4]));
  writeFileSync(join(root, modeOnly), "#!/bin/sh\nexit 0\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  writeFileSync(join(root, modified), Buffer.from([0, 5, 6]));
  writeFileSync(join(root, added), Buffer.from([0, 7, 8]));
  rmSync(join(root, deleted));
  writeFileSync(
    join(root, "source.ts"),
    Array.from(
      { length: 1000 },
      (_, i) => `export const value${i} = "source change";\n`,
    ).join(""),
  );
  git(root, "add", "-A");
  git(root, "update-index", "--chmod=+x", "--", modeOnly);
  const diff = git(
    root,
    "diff",
    "--cached",
    "--no-color",
    "--full-index",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  );
  assert.ok(diff.includes(`diff --git a/${modified} b/${modified}`));
  const beforeIndex = readFileSync(join(root, ".git/index"));
  const beforeContents = [modified, added, modeOnly, "source.ts"].map((path) =>
    readFileSync(join(root, path)),
  );

  const files = parseDiffFiles(diff);
  assert.deepEqual(
    files.map((file) => file.path).sort(),
    [...paths, "source.ts"].sort(),
  );
  for (const pattern of ["** b/**", ...paths]) {
    const result = await prepareContext({
      diff,
      budget: resolveContextBudget("custom", "local", {
        exclude: [pattern],
        summarize: true,
        maxSummaryRequests: 1,
      }),
      buildPrompt: (changes) => ({
        system: "Ground the message in these changes.",
        prompt: changes,
      }),
      summarize: async (request, beforeAttempt) => {
        beforeAttempt();
        for (const path of pattern === "** b/**" ? paths : [pattern])
          assert.ok(!request.prompt.includes(path));
        return "Export constants describing source changes.";
      },
    });
    for (const path of pattern === "** b/**" ? paths : [pattern]) {
      assert.equal(
        result.report.files.find((file) => file.path === path)?.treatment,
        "excluded",
      );
      assert.ok(!result.prompt.includes(path));
    }
    assert.equal(result.report.summaryRequests, 1);
  }
  assert.deepEqual(readFileSync(join(root, ".git/index")), beforeIndex);
  for (const [index, path] of [
    modified,
    added,
    modeOnly,
    "source.ts",
  ].entries())
    assert.deepEqual(readFileSync(join(root, path)), beforeContents[index]);
});

test("marker-less paths preserve whitespace and classify using the complete name", () => {
  for (const { path, kind } of [
    { path: " leading b/with and b/trailing ", kind: "source" },
    { path: "locks b/nested b/pnpm-lock.yaml", kind: "lockfile" },
    { path: "dist b/nested b/output.js", kind: "generated" },
  ]) {
    const diff = `diff --git a/${path} b/${path}\nold mode 100644\nnew mode 100755\n`;
    const [file] = parseDiffFiles(diff, ["dist b/**"]);
    assert.equal(file.path, path);
    assert.equal(file.originalPath, undefined);
    assert.equal(file.kind, kind);
    assert.ok(file.metadata.includes(`File: ${JSON.stringify(path)}`));
  }
});

test("real Git quoted paths, binary payloads and empty additions/deletions retain complete names", (t) => {
  const root = repository(t);
  const binary = "café b/界😀 and b/image.bin";
  const modeOnly = 'scripts b/line\n\t"quoted"\\界😀.sh';
  const added = "added b/empty b/file";
  const deleted = "deleted b/empty b/file";
  for (const path of [binary, modeOnly, added, deleted])
    mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, binary), Buffer.from([0, 1, 2]));
  writeFileSync(join(root, modeOnly), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(root, deleted), "");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  writeFileSync(join(root, binary), Buffer.from([0, 3, 4]));
  writeFileSync(join(root, added), "");
  rmSync(join(root, deleted));
  git(root, "add", "-A");
  git(root, "update-index", "--chmod=+x", "--", modeOnly);

  for (const quotePath of ["true", "false"]) {
    for (const payload of [[], ["--binary"]]) {
      const diff = git(
        root,
        "-c",
        `core.quotePath=${quotePath}`,
        "diff",
        "--cached",
        "--no-renames",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        ...payload,
      );
      assert.equal(diff.includes("GIT binary patch"), payload.length > 0);
      assert.ok(!diff.includes("\n--- "), "all changes are marker-less");
      const files = parseDiffFiles(diff);
      assert.deepEqual(
        files.map((file) => file.path).sort(),
        [binary, modeOnly, added, deleted].sort(),
      );
      for (const file of files) {
        assert.equal(file.originalPath, undefined);
        assert.equal(file.kind, file.path === binary ? "binary" : "source");
        assert.ok(file.metadata.includes(`File: ${JSON.stringify(file.path)}`));
        const change =
          file.path === added
            ? "added"
            : file.path === deleted
              ? "deleted"
              : "modified";
        assert.ok(file.metadata.includes(`Change: ${change};`));
      }
    }
  }
});

test("content markers resolve ambiguous modified, added and deleted text paths", () => {
  const original = "old b/nested and b/source.ts";
  const destination = "new b/nested and b/target.ts";
  for (const change of ["modified", "added", "deleted"]) {
    const oldPath = change === "added" ? destination : original;
    const newPath = change === "deleted" ? original : destination;
    const diff = [
      `diff --git a/${oldPath} b/${newPath}`,
      ...(change === "added" ? ["new file mode 100644"] : []),
      ...(change === "deleted" ? ["deleted file mode 100644"] : []),
      `--- ${change === "added" ? "/dev/null" : `a/${oldPath}\t`}`,
      `+++ ${change === "deleted" ? "/dev/null" : `b/${newPath}\t`}`,
      "@@ -1 +1 @@",
      ...(change === "added" ? [] : ["-old text"]),
      ...(change === "deleted" ? [] : ["+new text"]),
      "",
    ].join("\n");
    const [file] = parseDiffFiles(diff);
    assert.equal(file.path, newPath);
    assert.equal(
      file.originalPath,
      change === "modified" ? original : undefined,
    );
    assert.equal(file.kind, "source");
    assert.ok(file.metadata.includes(`Change: ${change};`));
  }
});

for (const operation of ["rename", "copy"]) {
  test(`${operation} metadata resolves differing ambiguous and quoted paths for exclusions`, async () => {
    const unquoted = "old b/nested and b/source.bin";
    const quoted = 'new b/line\t"quoted"\\é😀.bin';
    for (const [original, destination] of [
      [unquoted, "new b/nested and b/target.bin"],
      [unquoted, quoted],
      [quoted, unquoted],
    ]) {
      const encode = (path: string) =>
        /[\t"\\]/.test(path) ? JSON.stringify(path) : path;
      const diff = [
        `diff --git ${encode(`a/${original}`)} ${encode(`b/${destination}`)}`,
        "similarity index 100%",
        `${operation} from ${encode(original)}`,
        `${operation} to ${encode(destination)}`,
        "",
      ].join("\n");
      const [file] = parseDiffFiles(diff);
      assert.equal(file.path, destination);
      assert.equal(file.originalPath, original);
      assert.ok(file.metadata.includes(`File: ${JSON.stringify(destination)}`));
      assert.ok(file.metadata.includes(`(from ${JSON.stringify(original)})`));
      assert.match(file.metadata, /Change: (renamed|copied);/);
      for (const path of [original, destination]) {
        await assert.rejects(
          prepareContext({
            diff,
            budget: resolveContextBudget("custom", "local", {
              exclude: [path],
            }),
            buildPrompt: (changes) => ({ system: "", prompt: changes }),
          }),
          /No usable AI context/,
        );
      }
    }
  });
}
