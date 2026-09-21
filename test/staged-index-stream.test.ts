import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptions, SpawnSyncOptions } from "node:child_process";
import esmock from "esmock";

class GitChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code, signal));
  }

  kill() {
    this.killed = true;
    this.stdout.destroy();
    this.stderr.destroy();
    this.close(null, "SIGTERM");
    return true;
  }
}

async function mockGit(script: (child: GitChild) => void, spawnError?: Error) {
  const children: GitChild[] = [];
  const logs: string[] = [];
  const timers: { stops: number }[] = [];
  const state = { branch: "main", head: "a".repeat(40) };
  const { getStagedSnapshot } = await esmock<
    typeof import("../src/utils/git.ts")
  >("../src/utils/git.ts", {
    "node:child_process": {
      spawnSync: (
        command: string,
        args: string[],
        options: SpawnSyncOptions,
      ) => {
        assert.equal(command, "git");
        let stdout: string;
        if (args.join(" ") === "rev-parse --show-toplevel") {
          stdout = "/repository\n";
        } else {
          assert.equal(options.cwd, "/repository");
          if (args[0] === "branch") stdout = `${state.branch}\n`;
          else if (args[0] === "rev-parse") stdout = `${state.head}\n`;
          else {
            assert.equal(args[0], "diff");
            stdout = "tiny diff\n";
          }
        }
        return { status: 0, stdout, stderr: "" };
      },
      spawn: (command: string, args: string[], options: SpawnOptions) => {
        assert.equal(command, "git");
        assert.deepEqual(args, ["ls-files", "--stage", "--full-name", "-z"]);
        assert.equal(options.cwd, "/repository");
        assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
        if (spawnError) throw spawnError;
        const child = new GitChild();
        children.push(child);
        setImmediate(() => script(child));
        return child;
      },
    },
    "../src/utils/debug.ts": {
      debugLog: (_label: string, message: string) => logs.push(message),
      debugTime: () => {
        const timer = { stops: 0 };
        timers.push(timer);
        return () => timer.stops++;
      },
    },
  });
  return {
    capture: getStagedSnapshot,
    children,
    state,
    checkTiming: () => {
      assert.ok(logs.includes("git ls-files --stage --full-name -z"));
      assert.ok(timers.length > 0);
      assert.ok(timers.every((timer) => timer.stops === 1));
    },
  };
}

const entry = (file: string, stage = 0, objectLength = 40) =>
  Buffer.from(`100644 ${"a".repeat(objectLength)} ${stage}\t${file}\0`);
const oneByteChunks = (buffer: Buffer) =>
  Array.from(buffer, (_, offset) => buffer.subarray(offset, offset + 1));

test("index hashing is independent of chunks, including NULs and unusual path bytes", async () => {
  const index = Buffer.concat([
    entry(`line\nbreak\t100644 ${"a".repeat(40)} 3\tpath.txt`),
    entry("unicode-😀.txt"),
    Buffer.from(`100644 ${"b".repeat(64)} 0\traw-`),
    Buffer.from([0xff, 0]),
  ]);
  let chunks: Buffer[] = [index];
  const git = await mockGit((child) => {
    for (const chunk of chunks) child.stdout.write(chunk);
    child.close();
  });
  const snapshot = await git.capture();
  assert.equal(snapshot.branch, "main");
  assert.equal(snapshot.diff, "tiny diff\n");
  chunks = oneByteChunks(index);
  assert.deepEqual(await git.capture(), snapshot);

  // Invalid UTF-8 bytes must not collapse to the same replacement character.
  const changed = Buffer.from(index);
  changed[changed.length - 2] = 0xfe;
  chunks = oneByteChunks(changed);
  assert.notEqual((await git.capture()).fingerprint, snapshot.fingerprint);
  git.checkTiming();
});

test("index fingerprints retain branch and base identity with empty streamed output", async () => {
  const git = await mockGit((child) => child.close());
  git.state.head = "";
  const unborn = await git.capture();
  assert.deepEqual(await git.capture(), unborn);
  git.state.head = "a".repeat(40);
  const committed = await git.capture();
  assert.notEqual(committed.fingerprint, unborn.fingerprint);
  git.state.branch = "other";
  const other = await git.capture();
  assert.notEqual(other.fingerprint, committed.fingerprint);
  git.state.branch = "";
  const detached = await git.capture();
  assert.equal(detached.branch, "");
  assert.notEqual(detached.fingerprint, other.fingerprint);
  git.checkTiming();
});

for (const stage of [1, 2, 3]) {
  test(`index streaming detects stage ${stage} across header and NUL boundaries`, async () => {
    for (const objectLength of [40, 64]) {
      const index = Buffer.concat([
        entry("normal.txt"),
        entry("conflict\nwith\ttabs.txt", stage, objectLength),
        entry("after.txt"),
      ]);
      const git = await mockGit((child) => {
        for (const chunk of oneByteChunks(index)) child.stdout.write(chunk);
        child.close();
      });
      await assert.rejects(git.capture, /Resolve staged merge conflicts/);
      assert.equal(git.children.length, 1);
      git.checkTiming();
    }
  });
}

test("index streaming waits for exit and late stderr after stdout ends", async () => {
  const git = await mockGit((child) => {
    child.stdout.end(entry("normal.txt"));
    setImmediate(() => {
      child.stderr.write("fatal: index file corrupt\n");
      child.close(128);
    });
  });
  await assert.rejects(git.capture, /fatal: index file corrupt/);
  assert.equal(git.children.length, 1);
  git.checkTiming();
});

test("index streaming drains large stderr while retaining a bounded diagnostic", async () => {
  const git = await mockGit((child) => {
    child.stderr.write("fatal: index file corrupt\n");
    for (let i = 0; i < 32; i++) child.stderr.write("x".repeat(64 * 1024));
    child.close(128);
  });
  await assert.rejects(git.capture, (error: Error) => {
    assert.match(error.message, /^fatal: index file corrupt/);
    assert.ok(error.message.length <= 64 * 1024);
    return true;
  });
  git.checkTiming();
});

test("index streaming rejects nonzero exits and signals without stderr", async () => {
  for (const signal of [null, "SIGTERM"] as const) {
    const git = await mockGit((child) => {
      child.stdout.write(entry("normal.txt"));
      child.close(signal ? null : 1, signal);
    });
    await assert.rejects(git.capture, (error: Error) => {
      assert.match(error.message, /git ls-files --stage --full-name -z/);
      if (signal) assert.match(error.message, /SIGTERM/);
      return true;
    });
    git.checkTiming();
  }
});

test("index streaming propagates spawn errors and always finishes debug timing", async () => {
  const error = Object.assign(new Error("spawn git ENOENT"), {
    code: "ENOENT",
  });
  const git = await mockGit((child) => {
    child.emit("error", error);
    child.close(-2);
  });
  await assert.rejects(git.capture, (cause) => cause === error);
  git.checkTiming();

  const thrown = await mockGit(() => assert.fail("spawn should throw"), error);
  await assert.rejects(thrown.capture, (cause) => cause === error);
  thrown.checkTiming();
});

for (const stream of ["stdout", "stderr"] as const) {
  test(`index streaming terminates the child and propagates ${stream} errors`, async () => {
    const error = new Error(`${stream} read failed`);
    const git = await mockGit((child) => {
      child.stdout.write(entry("normal.txt"));
      child[stream].destroy(error);
    });
    await assert.rejects(git.capture, (cause) => cause === error);
    assert.equal(git.children.length, 1);
    assert.equal(git.children[0].killed, true);
    git.checkTiming();
  });
}
