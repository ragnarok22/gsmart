import "../test-support/setup-env";

import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { copyToClipboard, retrieveFilesToCommit } from "../src/utils/index";
import { getGitChanges } from "../src/utils/git";
import ora from "ora";

describe("index utils", () => {
  it("copyToClipboard handles success", async () => {
    await copyToClipboard("test text");
  });

  it("copyToClipboard handles errors gracefully", async () => {
    const consoleErrorMock = mock.method(console, "error", () => {});

    const clipboard = await import("clipboardy");
    const originalWrite = clipboard.default.write;

    clipboard.default.write = async () => {
      throw new Error("Clipboard error");
    };

    await copyToClipboard("test");

    clipboard.default.write = originalWrite;
    consoleErrorMock.mock.restore();

    assert.strictEqual(consoleErrorMock.mock.calls.length, 1);
  });

  it("retrieveFilesToCommit returns null when no changes and no status", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gsmart-index-"));
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "test@example.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });

    const cwd = process.cwd();
    process.chdir(repo);
    try {
      const spinner = ora();
      const failMock = mock.method(spinner, "fail", () => {});

      const result = await retrieveFilesToCommit(spinner);

      assert.strictEqual(result, null);
      assert.strictEqual(failMock.mock.calls.length, 1);

      failMock.mock.restore();
    } finally {
      process.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("retrieveFilesToCommit returns changes when already staged", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gsmart-index-"));
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "test@example.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });

    const cwd = process.cwd();
    process.chdir(repo);
    try {
      writeFileSync(join(repo, "file.txt"), "content");
      execSync("git add file.txt");

      const spinner = ora();
      const result = await retrieveFilesToCommit(spinner);

      assert.ok(result);
      assert.ok(result.includes("content"));
    } finally {
      process.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("retrieveFilesToCommit auto-stages all files", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gsmart-index-"));
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "test@example.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });

    const cwd = process.cwd();
    process.chdir(repo);
    try {
      writeFileSync(join(repo, "file1.txt"), "content1");
      writeFileSync(join(repo, "file2.txt"), "content2");

      const spinner = ora();
      const succeedMock = mock.method(spinner, "succeed", () => {});

      const result = await retrieveFilesToCommit(spinner, { autoStage: true });

      assert.ok(result);
      assert.ok(result.includes("content1"));
      assert.ok(result.includes("content2"));
      assert.strictEqual(succeedMock.mock.calls.length, 1);

      succeedMock.mock.restore();
    } finally {
      process.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("retrieveFilesToCommit handles renamed files in autoStage mode", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gsmart-index-"));
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "test@example.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });
    execSync("git config commit.gpgsign false", { cwd: repo });

    const cwd = process.cwd();
    process.chdir(repo);
    try {
      writeFileSync(join(repo, "old.txt"), "content");
      execSync("git add old.txt");
      execSync('git commit -m "initial"');

      execSync("git mv old.txt new.txt");

      const spinner = ora();
      const succeedMock = mock.method(spinner, "succeed", () => {});

      const result = await retrieveFilesToCommit(spinner, { autoStage: true });

      assert.ok(result);
      const changes = await getGitChanges();
      assert.ok(changes.includes("old.txt") || changes.includes("new.txt"));

      succeedMock.mock.restore();
    } finally {
      process.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("retrieveFilesToCommit handles added and deleted files in autoStage mode", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gsmart-index-"));
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "test@example.com"', { cwd: repo });
    execSync('git config user.name "Test"', { cwd: repo });
    execSync("git config commit.gpgsign false", { cwd: repo });

    const cwd = process.cwd();
    process.chdir(repo);
    try {
      // Create a file and commit it
      writeFileSync(join(repo, "to-delete.txt"), "delete me");
      execSync("git add to-delete.txt");
      execSync('git commit -m "initial"');

      // Delete the file
      execSync("git rm to-delete.txt");

      // Add a new file
      writeFileSync(join(repo, "added.txt"), "new file");

      const spinner = ora();
      const succeedMock = mock.method(spinner, "succeed", () => {});

      const result = await retrieveFilesToCommit(spinner, { autoStage: true });

      assert.ok(result);
      assert.ok(
        result.includes("to-delete.txt") || result.includes("added.txt"),
      );

      succeedMock.mock.restore();
    } finally {
      process.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
