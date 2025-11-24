import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import clipboard from "clipboardy";
import { copyToClipboard, retrieveFilesToCommit } from "../src/utils/index.ts";
import type { GitStatus } from "../src/definitions.ts";

// Import internal functions by testing their effects through public APIs
// We'll test the helper functions indirectly through retrieveFilesToCommit

test("copyToClipboard successfully writes text to clipboard", async () => {
  const testText = "test commit message";
  await copyToClipboard(testText);

  // Verify by reading from clipboard
  const clipboardContent = await clipboard.read();
  assert.equal(clipboardContent, testText);
});

test("copyToClipboard handles empty string", async () => {
  await copyToClipboard("");
  const clipboardContent = await clipboard.read();
  assert.equal(clipboardContent, "");
});

test("copyToClipboard handles multiline text", async () => {
  const multilineText = `feat: add new feature

- Add feature A
- Add feature B
- Update documentation`;

  await copyToClipboard(multilineText);
  const clipboardContent = await clipboard.read();
  assert.equal(clipboardContent, multilineText);
});

test("copyToClipboard handles special characters", async () => {
  const specialText = "fix: handle émojis 🚀 and spëcial chars @#$%";
  await copyToClipboard(specialText);
  const clipboardContent = await clipboard.read();
  assert.equal(clipboardContent, specialText);
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

    // Modify existing file
    writeFileSync("existing.txt", "new content");

    // Add new file
    writeFileSync("new.txt", "new file");

    const spinner = {
      stop: () => {},
      fail: () => {},
      succeed: () => {},
      info: () => {},
      isSpinning: true,
    };

    const result = await retrieveFilesToCommit(spinner, { autoStage: true });
    assert(result !== null);
    assert(result.includes("new content"));
    assert(result.includes("new file"));
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
