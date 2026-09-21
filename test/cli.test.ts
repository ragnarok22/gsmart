import "../test-support/setup-env";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

function runCLI(args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "gsmart-cli-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/index.ts", ...args],
      {
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
  assert.doesNotMatch(result.stdout, /^\s+generate\b/m);
  assert.match(result.stdout, /^\s+config\b/m);
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
