import "../test-support/setup-env";

import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import test from "node:test";
import assert from "node:assert/strict";

import {
  getGitBranch,
  getGitChanges,
  commitChanges,
  getGitStatus,
  parseGitStatusEntries,
  stageFile,
  getGitInfo,
} from "../src/utils/git.ts";
import { retrieveFilesToCommit } from "../src/utils/index.ts";

test("git utils basic flow", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "file.txt"), "hello");
    assert.equal(await stageFile("file.txt"), true);

    const diff = await getGitChanges();
    assert(diff.includes("hello"));

    assert.equal(await commitChanges("test commit"), true);
    assert.equal(await getGitChanges(), "");

    assert.deepEqual(await getGitInfo(), ["main", ""]);
    assert.equal(await getGitBranch(), "main");

    const status = await getGitStatus();
    assert.equal(status.length, 0);
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus lists untracked files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "a.txt"), "a");
    const status = await getGitStatus();
    assert.equal(status.length, 1);
    assert.equal(status[0].status, "??");
    assert.equal(status[0].file_name, "a.txt");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

const createSpinnerStub = () => {
  const spinner = {
    isSpinning: true,
    stop() {
      spinner.isSpinning = false;
    },
    fail() {
      spinner.isSpinning = false;
    },
    succeed() {
      spinner.isSpinning = false;
    },
    info() {},
  };

  return spinner;
};

test("retrieveFilesToCommit auto-stages files in non-interactive mode", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "auto.txt"), "auto-stage-me");
    const spinner = createSpinnerStub();
    const diff = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(diff && diff.includes("auto-stage-me"));

    const staged = await getGitChanges();
    assert(staged.includes("auto-stage-me"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus captures rename metadata", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "hello");
    execSync("git add file.txt");
    execSync('git commit -m "initial"');

    execSync("git mv file.txt renamed.txt");

    const status = await getGitStatus();
    assert.equal(status.length, 1);
    assert(status[0].status.startsWith("R"));
    assert.equal(status[0].file_path, "renamed.txt");
    assert.equal(status[0].original_path, "file.txt");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus handles malformed status lines", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "content");
    const status = await getGitStatus();
    assert.ok(Array.isArray(status));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("parseGitStatusEntries handles rename/copy scores", () => {
  const statusOutput =
    "R100 renamed.txt\0original.txt\0C100 copied.txt\0source.txt\0";
  const parsed = parseGitStatusEntries(statusOutput);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].status, "R100");
  assert.equal(parsed[0].file_name, "renamed.txt");
  assert.equal(parsed[0].file_path, "renamed.txt");
  assert.equal(parsed[0].original_path, "original.txt");
  assert.equal(parsed[1].status, "C100");
  assert.equal(parsed[1].file_name, "copied.txt");
  assert.equal(parsed[1].file_path, "copied.txt");
  assert.equal(parsed[1].original_path, "source.txt");
});

test("git commands work in non-git directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsmart-nogit-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const branch = await getGitBranch();
    assert.equal(branch, "");
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commitChanges fails gracefully", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsmart-nogit-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const result = await commitChanges("test");
    assert.equal(result, false);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stageFile handles empty array", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const result = await stageFile([]);
    assert.equal(result, true); // Should return true for empty array
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("stageFile handles duplicate file paths", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "file.txt"), "content");
    const result = await stageFile(["file.txt", "file.txt", "file.txt"]);
    assert.equal(result, true);

    const changes = await getGitChanges();
    assert(changes.includes("content"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("stageFile handles multiple files at once", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "file1.txt"), "content1");
    writeFileSync(join(repo, "file2.txt"), "content2");
    writeFileSync(join(repo, "file3.txt"), "content3");

    const result = await stageFile(["file1.txt", "file2.txt", "file3.txt"]);
    assert.equal(result, true);

    const changes = await getGitChanges();
    assert(changes.includes("content1"));
    assert(changes.includes("content2"));
    assert(changes.includes("content3"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("stageFile handles single file as string", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "single.txt"), "single file");
    const result = await stageFile("single.txt");
    assert.equal(result, true);

    const changes = await getGitChanges();
    assert(changes.includes("single file"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("stageFile returns false for non-existent file", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const result = await stageFile("nonexistent.txt");
    assert.equal(result, false);
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus handles modified files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "original");
    execSync("git add file.txt");
    execSync('git commit -m "initial"');

    writeFileSync("file.txt", "modified");
    execSync("git add file.txt"); // Stage the modification

    const status = await getGitStatus();
    assert.equal(status.length, 1);
    assert(status[0].status.includes("M"));
    assert.equal(status[0].file_name, "file.txt");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus handles unstaged modified files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "original");
    execSync("git add file.txt");
    execSync('git commit -m "initial"');

    writeFileSync("file.txt", "modified but not staged");
    // DO NOT stage the modification

    const status = await getGitStatus();
    assert.equal(status.length, 1);
    assert.equal(status[0].status, " M"); // Leading space indicates unstaged
    assert.equal(status[0].file_name, "file.txt");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus handles staged and unstaged changes", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "original");
    execSync("git add file.txt");
    execSync('git commit -m "initial"');

    writeFileSync("file.txt", "staged change");
    execSync("git add file.txt");

    writeFileSync("file.txt", "unstaged change");

    const status = await getGitStatus();
    assert.equal(status.length, 1);
    assert.equal(status[0].file_name, "file.txt");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus handles deleted files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "content");
    execSync("git add file.txt");
    execSync('git commit -m "initial"');

    rmSync("file.txt");
    execSync("git add file.txt"); // Stage the deletion

    const status = await getGitStatus();
    assert.equal(status.length, 1);
    assert(status[0].status.includes("D"));
    assert.equal(status[0].file_name, "file.txt");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitStatus handles copy operations", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
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

    execSync("cp original.txt copied.txt");
    execSync("git add copied.txt");

    const status = await getGitStatus();
    const copiedFile = status.find((s) => s.file_path === "copied.txt");
    assert(copiedFile, "Should find copied file in status");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("commitChanges accepts multiline commit messages", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "file.txt"), "content");
    await stageFile("file.txt");

    const multilineMessage = `feat: add new feature

This is a detailed description
of the feature with multiple lines

- Bullet 1
- Bullet 2`;

    const result = await commitChanges(multilineMessage);
    assert.equal(result, true);
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitChanges returns empty string when nothing is staged", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "unstaged.txt"), "not staged");

    const changes = await getGitChanges();
    assert.equal(changes, "");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitInfo returns branch and changes together", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b develop", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync(join(repo, "file.txt"), "content");
    await stageFile("file.txt");

    const [branch, changes] = await getGitInfo();
    assert.equal(branch, "develop");
    assert(changes.includes("content"));
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("getGitBranch handles detached HEAD state", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsmart-git-"));
  execSync("git init -b main", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  execSync("git config commit.gpgsign false", { cwd: repo });

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    writeFileSync("file.txt", "content");
    execSync("git add file.txt");
    execSync('git commit -m "initial"');

    // Detach HEAD
    const commitHash = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      cwd: repo,
    }).trim();
    execSync(`git checkout ${commitHash}`, { cwd: repo });

    const branch = await getGitBranch();
    // In detached HEAD, branch should be empty
    assert.equal(branch, "");
  } finally {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  }
});
