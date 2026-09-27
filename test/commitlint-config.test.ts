import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  git,
  repository,
  temporaryDirectory,
} from "../test-support/repository.ts";
import {
  adaptCommitlintRules,
  loadCommitlintConventions,
} from "../src/utils/commitlint-config.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import { loadEffectiveConventions } from "../src/utils/repository-config.ts";

test("compatible commitlint rules retain exact lengths, presence, blank-line policy and severity", () => {
  const imported = adaptCommitlintRules(
    {
      "type-enum": [2, "always", ["fix", "custom"]],
      "scope-enum": [1, "always", ["cli", "utils"]],
      "scope-empty": [2, "never"],
      "header-max-length": [2, "always", 72],
      "subject-max-length": [1, "always", 50],
      "body-empty": [1, "never"],
      "body-leading-blank": [2, "always"],
      "body-max-line-length": [2, "always", 100],
      "footer-leading-blank": [1, "never"],
    },
    "commitlint",
  );
  assert.deepEqual(imported.diagnostics, []);
  const result = resolveConventions(imported.layers);
  assert.deepEqual(result.conventions.types, ["fix", "custom"]);
  assert.deepEqual(result.conventions.scopes, ["cli", "utils"]);
  assert.equal(result.conventions.scope, "required");
  assert.equal(result.conventions.headerMaxLength, 72);
  assert.equal(result.conventions.subjectMaxLength, 50);
  assert.deepEqual(result.conventions.body, {
    presence: "required",
    leadingBlank: true,
    maxLineLength: 100,
    instructions: "",
  });
  assert.equal(result.conventions.footer.leadingBlank, false);
  assert.equal(result.ruleMetadata.scopes.severity, 1);
  assert.equal(result.ruleMetadata.types.severity, 2);
});

test("empty enumerations and Infinity remove limits, while inverted presence rules forbid content", () => {
  const { layers } = adaptCommitlintRules(
    {
      "type-enum": [2, "always", []],
      "scope-enum": [2, "always", []],
      "header-max-length": [2, "always", Infinity],
      "subject-max-length": [2, "always", Infinity],
      "body-max-line-length": [2, "always", Infinity],
      "scope-empty": [1, "always"],
      "body-empty": [2, "always"],
      "body-leading-blank": [2, "never"],
    },
    "commitlint",
  );
  const { conventions } = resolveConventions(layers);
  assert.equal(conventions.types, null);
  assert.equal(conventions.scopes, null);
  assert.equal(conventions.headerMaxLength, null);
  assert.equal(conventions.subjectMaxLength, null);
  assert.equal(conventions.body.maxLineLength, null);
  assert.equal(conventions.scope, "forbidden");
  assert.equal(conventions.body.presence, "forbidden");
  assert.equal(conventions.body.leadingBlank, false);
});

test("disabled rules do not warn; unsupported forms are diagnosed rather than misinterpreted", () => {
  const { layers, diagnostics } = adaptCommitlintRules(
    {
      "disabled-custom-rule": [0],
      "type-enum": [2, "never", ["fix"]],
      "scope-enum": [2, "always", { scopes: ["cli"], delimiters: ["|"] }],
      "header-max-length": [2, "never", 72],
      "subject-max-length": [2, "always", "72"],
      "body-max-line-length": [2, "always", -1],
      "body-empty": [2, "invalid"],
      "subject-case": [2, "never", ["upper-case"]],
      "plugin-custom": () => [2, "always"],
    },
    "commitlint.config.js",
  );
  assert.deepEqual(layers, []);
  assert.equal(diagnostics.length, 8);
  assert.ok(
    diagnostics.every(
      (message) =>
        message.includes("commitlint.config.js") && message.includes("README"),
    ),
  );
  assert.ok(
    diagnostics.every((message) => !message.includes("disabled-custom-rule")),
  );
});

for (const name of [
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yaml",
  ".commitlintrc.yml",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  ".commitlintrc.ts",
  ".commitlintrc.cts",
  ".commitlintrc.mts",
  "commitlint.config.ts",
  "commitlint.config.cts",
  "commitlint.config.mts",
]) {
  test(`standard loader supports ${name}`, async (t) => {
    const root = repository(t);
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    const config = JSON.stringify({
      rules: { "type-enum": [2, "always", ["team"]] },
    });
    const text = /\.(?:[cm]?[jt]s)$/.test(name)
      ? `${/\.(cjs|cts)$/.test(name) ? "module.exports =" : "export default"} ${config}`
      : name.endsWith("json")
        ? config
        : "rules:\n  type-enum: [2, always, [team]]\n";
    writeFileSync(join(root, name), text);
    const imported = await loadCommitlintConventions(root);
    assert.equal(imported.file, join(root, name));
    assert.deepEqual(resolveConventions(imported.layers).conventions.types, [
      "team",
    ]);
  });
}

test("package.json commitlint settings take priority over standalone files", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      commitlint: { rules: { "header-max-length": [2, "always", 60] } },
    }),
  );
  writeFileSync(
    join(root, "commitlint.config.cjs"),
    'throw new Error("wrong file loaded")',
  );
  const imported = await loadCommitlintConventions(root);
  assert.equal(imported.file, join(root, "package.json"));
  assert.equal(
    resolveConventions(imported.layers).conventions.headerMaxLength,
    60,
  );
});

test("shared presets and asynchronous rule factories resolve relative to the repository", async (t) => {
  const root = repository(t);
  const preset = join(root, "node_modules", "commitlint-config-team");
  mkdirSync(preset, { recursive: true });
  writeFileSync(
    join(preset, "package.json"),
    JSON.stringify({ name: "commitlint-config-team", main: "index.cjs" }),
  );
  writeFileSync(
    join(preset, "index.cjs"),
    'module.exports = { rules: { "type-enum": [2, "always", ["team"]], "header-max-length": [2, "always", 80] } }',
  );
  writeFileSync(
    join(root, "commitlint.config.cjs"),
    'module.exports = { extends: ["team"], rules: { "header-max-length": async () => [1, "always", 64] } }',
  );
  const imported = await loadCommitlintConventions(root);
  const result = resolveConventions(imported.layers);
  assert.deepEqual(result.conventions.types, ["team"]);
  assert.equal(result.conventions.headerMaxLength, 64);
  assert.equal(result.ruleMetadata.headerMaxLength.severity, 1);
});

test("commitlint discovery cannot inherit parent settings or nested overrides", async (t) => {
  const parent = temporaryDirectory(t);
  const root = join(parent, "repo");
  const nested = join(root, "src");
  mkdirSync(nested, { recursive: true });
  git(root, "init", "-q");
  writeFileSync(
    join(parent, "commitlint.config.cjs"),
    'throw new Error("parent loaded")',
  );
  writeFileSync(
    join(nested, "commitlint.config.cjs"),
    'throw new Error("nested loaded")',
  );
  const result = await loadEffectiveConventions({ cwd: nested });
  assert.equal(result.commitlintConfigPath, undefined);
  assert.equal(result.conventions.headerMaxLength, null);
});

test("disabled integration skips loading executable configs and invalid package manifests", async (t) => {
  const root = repository(t);
  writeFileSync(join(root, "package.json"), "invalid");
  writeFileSync(
    join(root, "commitlint.config.cjs"),
    'throw new Error("must not execute")',
  );
  writeFileSync(join(root, ".gsmartrc.json"), '{"commitlint":false}');
  const result = await loadEffectiveConventions({ cwd: root });
  assert.equal(result.conventions.commitlint, false);
  assert.equal(result.commitlintConfigPath, undefined);
});

test("malformed config, missing preset and invalid manifest have actionable errors", async (t) => {
  const root = repository(t);
  writeFileSync(join(root, "commitlint.config.cjs"), "invalid {{{");
  await assert.rejects(
    loadCommitlintConventions(root),
    /Could not load commitlint configuration.*commitlint.config.cjs.*"commitlint": false/s,
  );
  // Use another file/root to avoid Node's module cache for executable configs.
  const missing = repository(t);
  writeFileSync(
    join(missing, ".commitlintrc.json"),
    '{"extends":["missing-gsmart-test-preset"]}',
  );
  await assert.rejects(
    loadCommitlintConventions(missing),
    /install referenced presets/,
  );
  writeFileSync(join(root, "package.json"), "invalid");
  await assert.rejects(
    loadCommitlintConventions(root),
    /package.json.*valid JSON/,
  );
});
