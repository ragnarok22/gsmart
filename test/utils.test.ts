import "../test-support/setup-env";

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { copyToClipboard, retrieveFilesToCommit } from "../src/utils/index.ts";
import chalk from "chalk";

// Import internal functions by testing their effects through public APIs
// We'll test the helper functions indirectly through retrieveFilesToCommit

test("copyToClipboard writes text without throwing", async () => {
  const testText = "test commit message";
  // Should not throw
  await assert.doesNotReject(async () => {
    await copyToClipboard(testText);
  });
});

test("copyToClipboard handles empty string without throwing", async () => {
  await assert.doesNotReject(async () => {
    await copyToClipboard("");
  });
});

test("copyToClipboard handles multiline text without throwing", async () => {
  const multilineText = `feat: add new feature

- Add feature A
- Add feature B
- Update documentation`;

  await assert.doesNotReject(async () => {
    await copyToClipboard(multilineText);
  });
});

test("copyToClipboard handles special characters without throwing", async () => {
  const specialText = "fix: handle émojis 🚀 and spëcial chars @#$%";
  await assert.doesNotReject(async () => {
    await copyToClipboard(specialText);
  });
});

test("retrieveFilesToCommit returns null when no changes and no files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert.equal(result, null);
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit returns diff when changes are already staged", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "test.txt"), "content");
    execSync("git add test.txt");

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: false });
    assert(result !== null);
    assert(result.includes("content"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit auto-stages multiple files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "file1.txt"), "content1");
    writeFileSync(join(repo, "file2.txt"), "content2");
    writeFileSync(join(repo, "file3.txt"), "content3");

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(result !== null);
    assert(result.includes("content1"));
    assert(result.includes("content2"));
    assert(result.includes("content3"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit handles renamed files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("original.txt", "content");
    execSync("git add original.txt");
    execSync('git commit -m "initial"');
    execSync("git mv original.txt renamed.txt");

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(result !== null);
    assert(result.includes("renamed"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit handles deleted files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("todelete.txt", "content");
    execSync("git add todelete.txt");
    execSync('git commit -m "initial"');
    rmSync("todelete.txt");
    execSync("git add todelete.txt"); // Stage the deletion

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(result !== null);
    assert(result.includes("todelete.txt"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit handles mixed file statuses", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    // Create initial commit
    writeFileSync("existing.txt", "old content");
    execSync("git add existing.txt");
    execSync('git commit -m "initial"');

    // Add two new untracked files
    writeFileSync("new1.txt", "new file 1");
    writeFileSync("new2.txt", "new file 2");

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(result !== null);
    assert(result.includes("new file 1"));
    assert(result.includes("new file 2"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit handles files in subdirectories", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    execSync("mkdir -p src/utils");
    writeFileSync(
      join(repo, "src/utils/helper.ts"),
      "export const helper = () => {}",
    );
    writeFileSync(
      join(repo, "src/index.ts"),
      "import { helper } from './utils/helper'",
    );

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(result !== null);
    assert(result.includes("helper"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit returns null when prompt selects no files", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const repo = mkdtempSync(join(tmpdir(), "gsmart-utils-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);

  const promptsMock = mock.module("prompts", {
    defaultExport: async () => ({ files: [] }),
  });

  try {
    writeFileSync(join(repo, "unstaged.txt"), "content");

    const spinner = {
      stop: mock.fn(),
      fail: mock.fn(),
      succeed: mock.fn(),
      info: mock.fn(),
      isSpinning: true,
    };

    const { retrieveFilesToCommit: retrieveWithMock } =
      await import("../src/utils/index.ts?prompt-empty");

    const result = await retrieveWithMock(spinner, { autoStage: false });
    assert.equal(result, null);
    assert.equal(spinner.fail.mock.calls.length, 1);
  } finally {
    promptsMock.restore();
    mock.reset();
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("retrieveFilesToCommit formats choices and stops spinner for prompts", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const statusEntries = [
    {
      status: "??",
      file_name: "new.txt",
      file_path: "new.txt",
    },
    {
      status: " D",
      file_name: "removed.txt",
      file_path: "removed.txt",
    },
    {
      status: "R100",
      file_name: "renamed.txt",
      file_path: "renamed.txt",
      original_path: "original.txt",
    },
  ];

  let capturedPrompt: {
    choices: { title: string; value: unknown }[];
  } | null = null;
  let changesCalls = 0;
  const stageFileMock = mock.fn(async () => true);

  const promptsMock = mock.module("prompts", {
    defaultExport: async (options) => {
      capturedPrompt = options;
      return { files: options.choices.map((choice) => choice.value) };
    },
  });

  const gitMock = mock.module("../src/utils/git.ts", {
    getGitChanges: async () => (changesCalls++ === 0 ? "" : "diff"),
    getGitStatus: async () => statusEntries,
    stageFile: stageFileMock,
  });

  try {
    const { retrieveFilesToCommit: retrieveWithMock } =
      await import("../src/utils/index.ts?prompt-choices");

    const spinner = {
      stop: mock.fn(),
      fail: mock.fn(),
      succeed: mock.fn(),
      info: mock.fn(),
      isSpinning: true,
    };

    const result = await retrieveWithMock(spinner, { autoStage: false });

    assert.equal(result, "diff");
    assert.equal(spinner.stop.mock.calls.length, 1);
    assert.ok(capturedPrompt);
    assert.equal(capturedPrompt.choices.length, 3);
    assert.equal(capturedPrompt.choices[0].title, chalk.green("new.txt"));
    assert.equal(capturedPrompt.choices[1].title, chalk.red("removed.txt"));
    assert.equal(
      capturedPrompt.choices[2].title,
      chalk.cyan("original.txt → renamed.txt"),
    );
    assert.deepEqual(stageFileMock.mock.calls[0].arguments[0], [
      "new.txt",
      "removed.txt",
      "renamed.txt",
      "original.txt",
    ]);
  } finally {
    promptsMock.restore();
    gitMock.restore();
    mock.reset();
  }
});

test("retrieveFilesToCommit marks deleted statuses as red even when added", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const statusEntries = [
    {
      status: "AD",
      file_name: "conflicted.txt",
      file_path: "conflicted.txt",
    },
  ];

  let capturedPrompt: {
    choices: { title: string; value: unknown }[];
  } | null = null;
  let changesCalls = 0;
  const stageFileMock = mock.fn(async () => true);

  const promptsMock = mock.module("prompts", {
    defaultExport: async (options) => {
      capturedPrompt = options;
      return { files: options.choices.map((choice) => choice.value) };
    },
  });

  const gitMock = mock.module("../src/utils/git.ts", {
    getGitChanges: async () => (changesCalls++ === 0 ? "" : "diff"),
    getGitStatus: async () => statusEntries,
    stageFile: stageFileMock,
  });

  try {
    const { retrieveFilesToCommit: retrieveWithMock } =
      await import("../src/utils/index.ts?prompt-delete-priority");

    const spinner = {
      stop: mock.fn(),
      fail: mock.fn(),
      succeed: mock.fn(),
      info: mock.fn(),
      isSpinning: true,
    };

    const result = await retrieveWithMock(spinner, { autoStage: false });

    assert.equal(result, "diff");
    assert.ok(capturedPrompt);
    assert.equal(capturedPrompt.choices.length, 1);
    assert.equal(capturedPrompt.choices[0].title, chalk.red("conflicted.txt"));
  } finally {
    promptsMock.restore();
    gitMock.restore();
    mock.reset();
  }
});

test("retrieveFilesToCommit reports no status entries", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const gitMock = mock.module("../src/utils/git.ts", {
    getGitChanges: async () => "",
    getGitStatus: async () => [],
    stageFile: async () => true,
  });

  try {
    const { retrieveFilesToCommit: retrieveWithMock } =
      await import("../src/utils/index.ts?status-empty");

    const spinner = {
      stop: mock.fn(),
      fail: mock.fn(),
      succeed: mock.fn(),
      info: mock.fn(),
      isSpinning: true,
    };

    const result = await retrieveWithMock(spinner, { autoStage: false });
    assert.equal(result, null);
    assert.equal(spinner.fail.mock.calls.length, 1);
  } finally {
    gitMock.restore();
    mock.reset();
  }
});
