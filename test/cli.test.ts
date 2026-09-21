import "../test-support/setup-env";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { git, repository } from "../test-support/repository.ts";

function runCLI(args: string[], cwd = process.cwd()) {
  const directory = mkdtempSync(join(tmpdir(), "gsmart-cli-"));
  const entry =
    process.env.GSMART_TEST_CLI_ENTRY ??
    fileURLToPath(new URL("../src/index.ts", import.meta.url));
  try {
    const result = spawnSync(
      process.execPath,
      [
        ...(entry.endsWith(".ts")
          ? ["--import", import.meta.resolve("tsx")]
          : []),
        entry,
        ...args,
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          GSMART_CONFIG_DIR: directory,
          XDG_CONFIG_HOME: directory,
          NO_UPDATE_NOTIFIER: "1",
          FORCE_COLOR: "0",
        },
      },
    );
    assert.equal(result.error, undefined);
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it("root help exposes generation options and hides the compatibility alias", () => {
  const result = runCLI(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--provider/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /--language/);
  assert.match(result.stdout, /--history-examples/);
  assert.doesNotMatch(result.stdout, /^\s+generate\b/m);
  assert.match(result.stdout, /^\s+config\b/m);
});

it("effective configuration is identical from root and nested directories", (t) => {
  const root = repository(t);
  const nested = join(root, "src");
  mkdirSync(nested);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    '{"language":"es","instructions":"Team instructions"}',
  );
  writeFileSync(
    join(root, "commitlint.config.cjs"),
    'module.exports = { rules: { "header-max-length": [1, "always", 72] } }',
  );
  const outputs = [root, nested].map((cwd) => {
    const result = runCLI(
      ["config", "--show-effective", "--history-examples", "0"],
      cwd,
    );
    assert.equal(result.status, 0, result.stderr);
    const json = result.stdout.match(/^\{[\s\S]*^\}/m)?.[0];
    assert.ok(json, result.stdout);
    return JSON.parse(json);
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.equal(outputs[0].conventions.language, "es");
  assert.equal(outputs[0].conventions.headerMaxLength, 72);
  assert.equal(outputs[0].conventions.instructions, "Team instructions");
  assert.equal(outputs[0].conventions.history.enabled, false);
});

it("invalid repository config exits nonzero before --yes can stage files", (t) => {
  const root = repository(t);
  writeFileSync(join(root, ".gsmartrc.json"), '{"history":{"limit":100}}');
  writeFileSync(join(root, "change.txt"), "untracked changes");
  const result = runCLI(["--yes"], root);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /history\/limit.*<= 20/);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "");
});

it("the hidden generate alias still has useful help", () => {
  const result = runCLI(["generate", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--provider/);
  assert.match(result.stdout, /--yes/);
});

for (const shell of ["bash", "zsh", "fish"]) {
  it(`first-run ${shell} completion output contains only the script`, () => {
    const result = runCLI(["completions", shell]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.startsWith("#"), result.stdout);
    assert.doesNotMatch(
      result.stdout,
      /GSmart installed successfully|Quick start:|Update available/,
    );
  });
}
