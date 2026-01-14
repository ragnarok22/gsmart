import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const importSetupEnv = async () => {
  const cacheBust = Date.now().toString(36);
  return import(`../test-support/setup-env.ts?${cacheBust}`);
};

test("setup-env sets GSMART_CONFIG_DIR when unset", async () => {
  const originalEnv = process.env.GSMART_CONFIG_DIR;
  delete process.env.GSMART_CONFIG_DIR;

  try {
    await importSetupEnv();

    assert.ok(process.env.GSMART_CONFIG_DIR);
    assert.ok(existsSync(process.env.GSMART_CONFIG_DIR));
  } finally {
    if (process.env.GSMART_CONFIG_DIR) {
      rmSync(process.env.GSMART_CONFIG_DIR, { recursive: true, force: true });
    }
    if (originalEnv) {
      process.env.GSMART_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});

test("setup-env preserves GSMART_CONFIG_DIR when set", async () => {
  const originalEnv = process.env.GSMART_CONFIG_DIR;
  const presetDir = mkdtempSync(join(tmpdir(), "gsmart-preset-"));
  process.env.GSMART_CONFIG_DIR = presetDir;

  try {
    await importSetupEnv();

    assert.equal(process.env.GSMART_CONFIG_DIR, presetDir);
  } finally {
    rmSync(presetDir, { recursive: true, force: true });
    if (originalEnv) {
      process.env.GSMART_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});
