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
