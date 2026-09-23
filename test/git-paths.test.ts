import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getGitChanges,
  getGitStatus,
  getStagedFileNames,
  parseDiffFileNames,
  stageFile,
  unstageFiles,
} from "../src/utils/git.ts";
import { git, repository } from "../test-support/repository.ts";

test("status preserves whitespace and control characters in real Git paths", async (t) => {
  const root = repository(t);
  const names = [
    "a b.txt",
    " leading.txt",
    "trailing ",
    "line\nbreak.txt",
    "tab\tname.txt",
  ];
  for (const name of names) writeFileSync(join(root, name), "content");
  const previous = process.cwd();
  process.chdir(root);
  try {
    const status = await getGitStatus();
    assert.deepEqual(status.map((file) => file.file_path).sort(), names.sort());
    assert.ok(status.every((file) => file.status === "??"));
  } finally {
    process.chdir(previous);
  }
});

test("staging and unstaging treat selected filenames as literal pathspecs", async (t) => {
  const root = repository(t);
  const selected = "entry[ab].txt";
  const other = "entrya.txt";
  for (const name of [selected, other])
    writeFileSync(join(root, name), "content");
  const previous = process.cwd();
  process.chdir(root);
  try {
    assert.equal(await stageFile(selected), true);
    assert.deepEqual(
      git(root, "diff", "--cached", "--name-only", "-z")
        .split("\0")
        .filter(Boolean),
      [selected],
    );
    git(root, "add", "--", other);
    assert.equal(await unstageFiles(selected), true);
    assert.deepEqual(
      git(root, "diff", "--cached", "--name-only", "-z")
        .split("\0")
        .filter(Boolean),
      [other],
    );
  } finally {
    process.chdir(previous);
  }
});

test("unstaging a literal glob-like filename preserves other staged files", async (t) => {
  const root = repository(t);
  const selected = "entry[ab].txt";
  const other = "entrya.txt";
  for (const name of [selected, other])
    writeFileSync(join(root, name), "content");
  git(root, "add", ".");
  const previous = process.cwd();
  process.chdir(root);
  try {
    assert.equal(await unstageFiles([selected, selected]), true);
    assert.deepEqual(
      git(root, "diff", "--cached", "--name-only", "-z")
        .split("\0")
        .filter(Boolean),
      [other],
    );
  } finally {
    process.chdir(previous);
  }
});

test("staged filenames preserve whitespace, Unicode, and control characters", async (t) => {
  const root = repository(t);
  const names = [
    " leading.txt",
    "café.txt",
    "line\nbreak.txt",
    "tab\tname.txt",
    "trailing ",
  ];
  for (const name of names) writeFileSync(join(root, name), "content");
  git(root, "add", ".");
  const previous = process.cwd();
  process.chdir(root);
  try {
    assert.deepEqual((await getStagedFileNames()).sort(), names.sort());
  } finally {
    process.chdir(previous);
  }
});

test("status preserves whitespace and control characters in renamed paths", async (t) => {
  const root = repository(t);
  const original = " original\tname\n ";
  const renamed = " renamed\tname\n ";
  writeFileSync(join(root, original), "renamed content");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  git(root, "mv", "--", original, renamed);
  const previous = process.cwd();
  process.chdir(root);
  try {
    assert.deepEqual(await getGitStatus(), [
      {
        status: "R ",
        file_name: renamed,
        file_path: renamed,
        original_path: original,
      },
    ]);
  } finally {
    process.chdir(previous);
  }
});

test("dry-run filenames decode Git-quoted paths and renamed destinations", async (t) => {
  const root = repository(t);
  const names = ["café.txt", "line\nbreak.txt"];
  writeFileSync(join(root, "original.txt"), "renamed content");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  git(root, "mv", "original.txt", "renamed café.txt");
  for (const name of names) writeFileSync(join(root, name), "added content");
  git(root, "add", ".");
  const previous = process.cwd();
  process.chdir(root);
  try {
    assert.deepEqual(
      parseDiffFileNames(await getGitChanges()).sort(),
      [...names, "renamed café.txt"].sort(),
    );
  } finally {
    process.chdir(previous);
  }
});
