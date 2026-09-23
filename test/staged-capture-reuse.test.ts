import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type SpawnOptions } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import esmock from "esmock";
import { git, repository } from "../test-support/repository.ts";
import { resolveConventions } from "../src/utils/conventions.ts";

test("an already-staged automatic commit only captures one complete patch", async (t) => {
  const root = repository(t);
  writeFileSync(join(root, "file.txt"), "staged fixture\n");
  git(root, "add", "file.txt");
  writeFileSync(join(root, "file.txt"), "unstaged edit\n");
  let diffReads = 0;
  let indexReads = 0;
  const { createMainCommand } = await esmock<
    typeof import("../src/commands/main.ts")
  >(
    "../src/commands/main.ts",
    {},
    {
      "node:child_process": {
        spawn: (command: string, args: string[], options: SpawnOptions) => {
          if (command === "git" && args[0] === "diff") diffReads++;
          if (command === "git" && args[0] === "ls-files") indexReads++;
          return spawn(command, args, options);
        },
      },
    },
  );
  const spinner = {
    text: "",
    start() {
      return this;
    },
    stop() {
      return this;
    },
    info() {},
    succeed() {},
    warn() {},
    fail(message: string) {
      assert.fail(message);
    },
  };
  const committed: string[] = [];
  const command = createMainCommand({
    spinner: (() => spinner) as never,
    config: {
      getDefaultProvider: () => "anthropic",
      getKey: () => "sk-ant-fixture",
      getModel: () => "",
      getPrompt: () => "",
    } as never,
    getActiveProviders: () => [
      {
        value: "anthropic",
        title: "Anthropic",
        active: true,
        description: "fixture",
      },
    ],
    loadEffectiveConventions: async () => resolveConventions(),
    AIBuilder: class {
      async generateCommitMessage(_branch: string, diff: string) {
        assert.match(diff, /staged fixture/);
        assert.doesNotMatch(diff, /unstaged edit/);
        return "feat: fixture";
      }
    },
    commitChanges: async (message) => {
      committed.push(message);
      return true;
    },
    log: () => {},
    setExitCode: (code) => assert.fail(`unexpected exit code ${code}`),
  });
  const previous = process.cwd();
  process.chdir(root);
  try {
    await command.action({ yes: true });
    assert.deepEqual(committed, ["feat: fixture"]);
    assert.equal(diffReads, 1);
    assert.equal(
      indexReads,
      4,
      "both initial capture and pre-commit reuse verify index stability",
    );
  } finally {
    process.chdir(previous);
  }
});

test("snapshot reuse refreshes when the index changes between identity checks", async (t) => {
  const root = repository(t);
  writeFileSync(join(root, "file.txt"), "original staged content\n");
  git(root, "add", "file.txt");
  let diffReads = 0;
  let changeIndex = false;
  const { getStagedSnapshot } = await esmock<
    typeof import("../src/utils/git.ts")
  >("../src/utils/git.ts", {
    "node:child_process": {
      spawn: (command: string, args: string[], options: SpawnOptions) => {
        const child = spawn(command, args, options);
        if (args[0] === "diff") diffReads++;
        if (args[0] === "ls-files" && changeIndex) {
          changeIndex = false;
          child.on("close", () => {
            writeFileSync(
              join(root, "file.txt"),
              "concurrent staged content\n",
            );
            git(root, "add", "file.txt");
          });
        }
        return child;
      },
    },
  });
  const previous = process.cwd();
  process.chdir(root);
  try {
    const original = await getStagedSnapshot();
    assert.deepEqual(await getStagedSnapshot(original), original);
    assert.equal(diffReads, 1, "unchanged snapshots reuse their patch");
    changeIndex = true;
    const changed = await getStagedSnapshot(original);
    assert.notEqual(changed.fingerprint, original.fingerprint);
    assert.match(changed.diff, /concurrent staged content/);
    assert.doesNotMatch(changed.diff, /original staged content/);
    assert.equal(diffReads, 2);
  } finally {
    process.chdir(previous);
  }
});
