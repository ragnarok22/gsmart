import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import esmock from "esmock";
import { getStagedSnapshot, commitChanges } from "../src/utils/git.ts";

async function withRepository(
  action: (git: (...args: string[]) => string) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "gsmart-snapshot-"));
  const cwd = process.cwd();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    process.chdir(root);
    await action(git);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

test("staged snapshot supports unborn HEAD and ignores unstaged content", async () => {
  await withRepository(async (git) => {
    writeFileSync("file.txt", "staged version\n");
    git("add", "file.txt");
    const initial = await getStagedSnapshot();
    assert.equal(initial.branch, "main");
    assert.match(initial.diff, /staged version/);
    writeFileSync("file.txt", "unstaged version\n");
    assert.deepEqual(await getStagedSnapshot(), initial);
    git("add", "file.txt");
    const changed = await getStagedSnapshot();
    assert.notEqual(changed.fingerprint, initial.fingerprint);
    assert.match(changed.diff, /unstaged version/);
  });
});

test("staged snapshot detects binary-content and mode-only changes", async () => {
  await withRepository(async (git) => {
    writeFileSync("binary.dat", Buffer.from([0, 1, 2]));
    git("add", "binary.dat");
    const initial = await getStagedSnapshot();
    writeFileSync("binary.dat", Buffer.from([0, 3, 4]));
    git("add", "binary.dat");
    const changed = await getStagedSnapshot();
    assert.notEqual(changed.fingerprint, initial.fingerprint);
    git("update-index", "--chmod=+x", "binary.dat");
    assert.notEqual(
      (await getStagedSnapshot()).fingerprint,
      changed.fingerprint,
    );
  });
});

test("staged snapshot detects renames, deletions, HEAD changes, and an empty index", async () => {
  await withRepository(async (git) => {
    writeFileSync("file.txt", "original\n");
    git("add", "file.txt");
    git("commit", "-m", "initial");
    const empty = await getStagedSnapshot();
    assert.equal(empty.diff, "");
    git("commit", "--allow-empty", "-m", "new base");
    assert.notEqual((await getStagedSnapshot()).fingerprint, empty.fingerprint);
    git("mv", "file.txt", "renamed.txt");
    const renamed = await getStagedSnapshot();
    assert.match(renamed.diff, /rename to renamed.txt/);
    git("rm", "-f", "renamed.txt");
    assert.notEqual(
      (await getStagedSnapshot()).fingerprint,
      renamed.fingerprint,
    );
    git("reset", "--hard", "HEAD");
    assert.equal((await getStagedSnapshot()).diff, "");
  });
});

test("staged snapshot reports Git inspection errors instead of an empty snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "gsmart-no-repository-"));
  const cwd = process.cwd();
  try {
    process.chdir(root);
    await assert.rejects(getStagedSnapshot);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("staged snapshot includes the entire repository when run from a subdirectory", async () => {
  await withRepository(async (git) => {
    mkdirSync("nested");
    writeFileSync("nested/inside.txt", "inside");
    writeFileSync("outside.txt", "outside");
    git("add", ".");
    const rootSnapshot = await getStagedSnapshot();
    process.chdir("nested");
    assert.deepEqual(await getStagedSnapshot(), rootSnapshot);
    writeFileSync("../outside.txt", "outside changed");
    git("add", "outside.txt");
    assert.notEqual(
      (await getStagedSnapshot()).fingerprint,
      rootSnapshot.fingerprint,
    );
  });
});

test("staged snapshot rejects unresolved merge conflicts", async () => {
  await withRepository(async (git) => {
    writeFileSync("file.txt", "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("checkout", "-b", "other");
    writeFileSync("file.txt", "other\n");
    git("commit", "-am", "other");
    git("checkout", "main");
    writeFileSync("file.txt", "main\n");
    git("commit", "-am", "main");
    assert.throws(() => git("merge", "other"));
    await assert.rejects(getStagedSnapshot, /Resolve staged merge conflicts/);
  });
});

test("commitChanges preserves a multiline message through Git", async () => {
  await withRepository(async (git) => {
    writeFileSync("file.txt", "content");
    git("add", "file.txt");
    const message =
      "feat: subject\n\nFirst paragraph.\nSecond line.\n\nRefs: #499";
    assert.equal(await commitChanges(message), true);
    assert.equal(git("log", "-1", "--format=%B").trimEnd(), message);
  });
});

test("staged snapshot retries and discards a diff captured while the index changed", async () => {
  await withRepository(async (git) => {
    writeFileSync("file.txt", "initial staged version\n");
    git("add", "file.txt");
    let diffReads = 0;
    const { getStagedSnapshot: capture } = await esmock<
      typeof import("../src/utils/git.ts")
    >("../src/utils/git.ts", {
      "node:child_process": {
        spawn: (command: string, args: string[], options: SpawnOptions) => {
          const result = spawn(command, args, options);
          if (args[0] === "diff" && ++diffReads === 1) {
            // Simulate another process staging content between the diff read
            // and the following identity check, using a real Git index.
            result.on("close", () => {
              writeFileSync("file.txt", "stable updated version\n");
              git("add", "file.txt");
            });
          }
          return result;
        },
      },
    });
    const snapshot = await capture();
    assert.equal(diffReads, 2);
    assert.match(snapshot.diff, /stable updated version/);
    assert.ok(!snapshot.diff.includes("initial staged version"));
    assert.deepEqual(snapshot, await getStagedSnapshot());
  });
});

test("staged snapshot fails after bounded retries when staging never settles", async () => {
  await withRepository(async (git) => {
    writeFileSync("file.txt", "initial staged version\n");
    git("add", "file.txt");
    let diffReads = 0;
    const { getStagedSnapshot: capture } = await esmock<
      typeof import("../src/utils/git.ts")
    >("../src/utils/git.ts", {
      "node:child_process": {
        spawn: (command: string, args: string[], options: SpawnOptions) => {
          const result = spawn(command, args, options);
          if (args[0] === "diff") {
            diffReads++;
            result.on("close", () => {
              writeFileSync("file.txt", `concurrent version ${diffReads}\n`);
              git("add", "file.txt");
            });
          }
          return result;
        },
      },
    });
    await assert.rejects(
      capture,
      /Staged changes kept changing.*Finish staging and try again/,
    );
    assert.equal(diffReads, 3);
    assert.match(git("diff", "--cached"), /concurrent version 3/);
  });
});

test("staged snapshot supports an index larger than 1 MiB with a tiny staged diff", async () => {
  await withRepository(async (git) => {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      input: "shared baseline content\n",
      encoding: "utf8",
    }).trim();
    // Populate the real index without creating thousands of working-tree files.
    const entries = Array.from(
      { length: 18_000 },
      (_, index) =>
        `100644 ${blob}\ttracked/path-${String(index).padStart(5, "0")}.txt\n`,
    ).join("");
    assert.ok(Buffer.byteLength(entries) > 1024 * 1024);
    execFileSync("git", ["update-index", "--index-info"], { input: entries });
    git("commit", "--quiet", "-m", "large baseline");

    writeFileSync("tiny.txt", "small staged change\n");
    git("add", "tiny.txt");
    const diff = git("diff", "--cached");
    assert.ok(Buffer.byteLength(diff) < 1024);
    const snapshot = await getStagedSnapshot();
    assert.equal(snapshot.diff, git("diff", "--cached", "--full-index"));
    assert.equal(snapshot.branch, "main");
    assert.deepEqual(await getStagedSnapshot(), snapshot);

    writeFileSync("tiny.txt", "another small staged change\n");
    git("add", "tiny.txt");
    const changed = await getStagedSnapshot();
    assert.notEqual(changed.fingerprint, snapshot.fingerprint);
    assert.match(changed.diff, /another small staged change/);
  });
});
