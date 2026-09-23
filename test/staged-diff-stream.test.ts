import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";
import { spawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import esmock from "esmock";
import { repository, git } from "../test-support/repository.ts";
import { getGitChanges, getStagedSnapshot } from "../src/utils/git.ts";

function inRepository(t: TestContext) {
  const root = repository(t);
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  process.chdir(root);
  return root;
}

function diffProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: mock.fn(() => {
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    }),
  });
  return child;
}

async function mockDiff(
  t: TestContext,
  read: (child: ReturnType<typeof diffProcess>) => void,
) {
  inRepository(t);
  return esmock<typeof import("../src/utils/git.ts")>("../src/utils/git.ts", {
    "node:child_process": {
      spawn: (command: string, args: string[], options: SpawnOptions) => {
        if (args[0] !== "diff") return spawn(command, args, options);
        const child = diffProcess();
        queueMicrotask(() => read(child));
        return child;
      },
    },
  });
}

test("staged diff reads override formatting and external helpers from Git config", async (t) => {
  const root = inRepository(t);
  mkdirSync("nested");
  writeFileSync(".gitattributes", "*.txt diff=custom\n");
  writeFileSync("nested/inside.txt", "inside staged\n");
  writeFileSync("outside.txt", "outside staged\n");
  git(root, "add", ".");
  git(root, "config", "diff.noprefix", "true");
  git(root, "config", "diff.mnemonicPrefix", "true");
  git(root, "config", "diff.srcPrefix", "old/");
  git(root, "config", "diff.dstPrefix", "new/");
  git(root, "config", "diff.relative", "true");
  git(root, "config", "color.ui", "always");
  git(root, "config", "diff.external", "gsmart-nonexistent-diff-command");
  git(root, "config", "diff.custom.command", "gsmart-nonexistent-diff-command");
  git(root, "config", "diff.custom.textconv", "gsmart-nonexistent-textconv");
  const beforeIndex = readFileSync(".git/index");
  const snapshot = await getStagedSnapshot();
  process.chdir("nested");
  const diff = await getGitChanges();
  assert.equal(diff, snapshot.diff);
  assert.deepEqual(await getStagedSnapshot(), snapshot);
  assert.match(diff, /^diff --git a\/outside.txt b\/outside.txt$/m);
  assert.match(
    diff,
    /^diff --git a\/nested\/inside.txt b\/nested\/inside.txt$/m,
  );
  assert.match(diff, /^index [a-f0-9]{40}\.\.[a-f0-9]{40}$/m);
  assert.match(diff, /\+inside staged/);
  assert.match(diff, /\+outside staged/);
  assert.ok(!diff.includes("\u001b"));
  assert.deepEqual(readFileSync("../.git/index"), beforeIndex);
});

test("failed reads of a real corrupt index reject without modifying files", async (t) => {
  inRepository(t);
  writeFileSync("file.txt", "private unstaged work\n");
  const index = Buffer.from("invalid index\n");
  writeFileSync(".git/index", index);
  await assert.rejects(getGitChanges, /index/);
  await assert.rejects(getStagedSnapshot, /index/);
  assert.deepEqual(readFileSync(".git/index"), index);
  assert.equal(readFileSync("file.txt", "utf8"), "private unstaged work\n");
});

test("staged diff capture preserves UTF-8 across chunks and trailing whitespace", async (t) => {
  const expected = "diff with café and 🚀\n+trailing spaces  \n";
  const bytes = Buffer.from(expected);
  const reader = await mockDiff(t, (child) => {
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    child.stdout.end();
    child.emit("close", 0);
  });
  assert.equal(await reader.getGitChanges(), expected);
  assert.equal((await reader.getStagedSnapshot()).diff, expected);
});

test("staged diff capture rejects partial output on nonzero exit and bounds stderr", async (t) => {
  const reader = await mockDiff(t, (child) => {
    child.stdout.write("partial patch");
    child.stderr.write("fatal: read failed\n");
    for (let i = 0; i < 100; i++) child.stderr.write("x".repeat(4096));
    child.stderr.write("discarded diagnostic suffix");
    child.emit("close", 128);
  });
  for (const capture of [reader.getGitChanges, reader.getStagedSnapshot]) {
    await assert.rejects(capture, (error: Error) => {
      assert.match(error.message, /fatal: read failed/);
      assert.ok(error.message.length < 66 * 1024);
      assert.ok(!error.message.includes("discarded diagnostic suffix"));
      return true;
    });
  }
});

test("staged diff capture reports signal termination even without stderr", async (t) => {
  const reader = await mockDiff(t, (child) => {
    child.stdout.write("partial patch");
    child.emit("close", null, "SIGTERM");
  });
  await assert.rejects(reader.getGitChanges, /SIGTERM/);
});

test("staged diff capture reports the exit code when Git fails without stderr", async (t) => {
  const reader = await mockDiff(t, (child) => {
    child.stdout.write("partial patch must not be returned");
    child.emit("close", 2);
  });
  await assert.rejects(
    reader.getGitChanges,
    /Failed to read staged Git diff: git exited with code 2/,
  );
});

test("multiple stream errors preserve the original failure and terminate the child once", async (t) => {
  const failure = new Error("stdout read failure");
  const children: ReturnType<typeof diffProcess>[] = [];
  const reader = await mockDiff(t, (child) => {
    children.push(child);
    child.stdout.write("partial patch");
    child.stdout.emit("error", failure);
    child.stderr.emit("error", new Error("secondary stderr failure"));
    child.emit("error", new Error("secondary process failure"));
    child.stdout.write("output arriving after failure");
  });
  await assert.rejects(reader.getGitChanges, (error) => error === failure);
  await assert.rejects(reader.getStagedSnapshot, (error) => error === failure);
  assert.ok(children.every((child) => child.kill.mock.callCount() === 1));
});

test("staged diff capture propagates process launch errors", async (t) => {
  const failure = new Error("spawn git ENOENT");
  const reader = await mockDiff(t, (child) => {
    child.emit("error", failure);
    child.emit("close", -2);
  });
  await assert.rejects(reader.getGitChanges, (error) => error === failure);
  await assert.rejects(reader.getStagedSnapshot, (error) => error === failure);
});

for (const stream of ["stdout", "stderr"] as const) {
  test(`staged diff capture propagates ${stream} failure after process exit`, async (t) => {
    const failure = new Error(`${stream} read failed`);
    const children: ReturnType<typeof diffProcess>[] = [];
    const reader = await mockDiff(t, (child) => {
      children.push(child);
      child.stdout.write("partial patch");
      child.stdout.end();
      child.emit("exit", 0);
      child[stream].emit("error", failure);
      child.emit("close", 0);
    });
    await assert.rejects(reader.getGitChanges, (error) => error === failure);
    await assert.rejects(
      reader.getStagedSnapshot,
      (error) => error === failure,
    );
    for (const child of children) assert.equal(child.kill.mock.callCount(), 1);
  });
}

test("staged diff capture stops and rejects output over 64 MiB", async (t) => {
  const chunk = Buffer.alloc(1024 * 1024, "x");
  const children: ReturnType<typeof diffProcess>[] = [];
  const reader = await mockDiff(t, (child) => {
    children.push(child);
    for (let i = 0; i < 64; i++) child.stdout.write(chunk);
    assert.equal(child.kill.mock.callCount(), 0, "64 MiB is within the limit");
    child.stdout.write(Buffer.from("x"));
    assert.equal(child.kill.mock.callCount(), 1);
    child.stdout.write(chunk);
    child.stderr.write("diagnostic after termination");
  });
  await assert.rejects(reader.getGitChanges, /64 MiB.*limit/);
  await assert.rejects(reader.getStagedSnapshot, /64 MiB.*limit/);
  for (const child of children) assert.equal(child.kill.mock.callCount(), 1);
});
