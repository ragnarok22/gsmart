import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  git,
  repository,
  temporaryDirectory,
} from "../test-support/repository.ts";
import {
  loadRepositoryConfig,
  loadEffectiveConventions,
} from "../src/utils/repository-config.ts";
import { parseConventions } from "../src/utils/conventions.ts";

test("the documented team configuration validates against the shipped schema", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const example = readme
    .split("### Shared repository conventions")[1]
    .match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.ok(example);
  const conventions = parseConventions(JSON.parse(example), "README example");
  assert.equal(conventions.headerMaxLength, 72);
  assert.equal(conventions.history?.enabled, false);
});

test("root and nested directories discover the same configuration; nested files cannot override it", async (t) => {
  const root = repository(t);
  const nested = join(root, "packages", "app");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({ language: "es", types: ["fix"] }),
  );
  writeFileSync(join(nested, ".gsmartrc.json"), "malformed nested config");
  assert.deepEqual(
    await loadRepositoryConfig(nested),
    await loadRepositoryConfig(root),
  );
  const effective = await loadEffectiveConventions({ cwd: nested });
  assert.equal(effective.root, root);
  assert.equal(effective.conventions.language, "es");
  assert.deepEqual(effective.conventions.types, ["fix"]);
});

test("a worktree discovers its own root and configuration", async (t) => {
  const root = repository(t);
  git(root, "commit", "--allow-empty", "-qm", "chore: initial");
  const worktree = join(temporaryDirectory(t), "worktree");
  git(root, "worktree", "add", "-q", "-b", "other", worktree);
  writeFileSync(join(root, ".gsmartrc.json"), '{"language":"en"}');
  writeFileSync(join(worktree, ".gsmartrc.json"), '{"language":"pt-BR"}');
  const nested = join(worktree, "src");
  mkdirSync(nested);
  const effective = await loadEffectiveConventions({ cwd: nested });
  assert.equal(effective.root, worktree);
  assert.equal(effective.conventions.language, "pt-BR");
});

test("absent repository configuration falls back to the saved user prompt and built-ins", async (t) => {
  for (const cwd of [repository(t), temporaryDirectory(t)]) {
    const effective = await loadEffectiveConventions({
      cwd,
      user: { instructions: "User prompt" },
    });
    assert.equal(effective.conventions.instructions, "User prompt");
    assert.equal(effective.conventions.language, "en");
    assert.equal(effective.repositoryConfigPath, undefined);
    assert.equal(effective.commitlintConfigPath, undefined);
  }
});

test("configuration errors include the file and expected correction", async (t) => {
  const root = repository(t);
  const file = join(root, ".gsmartrc.json");
  writeFileSync(file, '{"language":"es",}');
  await assert.rejects(
    loadRepositoryConfig(root),
    (error: Error) =>
      error.message.includes(file) && error.message.includes("trailing commas"),
  );
  writeFileSync(file, '{"history":{"limit":30}}');
  await assert.rejects(loadRepositoryConfig(root), /history\/limit.*<= 20/);
});

test("a config path that is a directory reports a read error", async (t) => {
  const root = repository(t);
  mkdirSync(join(root, ".gsmartrc.json"));
  await assert.rejects(
    loadRepositoryConfig(root),
    /Cannot read.*\.gsmartrc.json/,
  );
});

test("effective precedence imports commitlint between user and repository settings", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".commitlintrc.json"),
    JSON.stringify({
      rules: {
        "header-max-length": [1, "always", 72],
        "subject-max-length": [2, "always", 60],
      },
    }),
  );
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({
      instructions: "Repo",
      language: "es",
      headerMaxLength: 80,
      history: { enabled: true, limit: 4 },
    }),
  );
  const result = await loadEffectiveConventions({
    cwd: root,
    user: { instructions: "User", subjectMaxLength: 90 },
    cli: { instructions: "CLI", language: "pt", history: { enabled: false } },
  });
  assert.equal(result.conventions.instructions, "CLI");
  assert.equal(result.conventions.language, "pt");
  assert.equal(result.conventions.headerMaxLength, 80);
  assert.equal(result.conventions.subjectMaxLength, 60);
  assert.deepEqual(result.conventions.history, { enabled: false, limit: 4 });
  assert.equal(result.sources.headerMaxLength, join(root, ".gsmartrc.json"));
  assert.equal(
    result.sources.subjectMaxLength,
    join(root, ".commitlintrc.json"),
  );
  assert.deepEqual(result.ruleMetadata, {
    subjectMaxLength: { name: "subject-max-length", severity: 2 },
  });
});

test("commitlint can resolve a lower-priority conflict before final validation", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".commitlintrc.json"),
    JSON.stringify({ rules: { "body-empty": [2, "never"] } }),
  );
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({ tickets: { required: true, placement: "body" } }),
  );
  const effective = await loadEffectiveConventions({
    cwd: root,
    user: { body: { presence: "forbidden" } },
  });
  assert.equal(effective.conventions.body.presence, "required");
});
