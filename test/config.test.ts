import "../test-support/setup-env";

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import assert from "node:assert/strict";

const importConfig = async () => {
  // append query to bust module cache
  return (await import("../src/utils/config.ts?" + Date.now())).default;
};

test("set, get and clear key", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const config = await importConfig();
  try {
    config.setKey("openai", "abc");
    assert.equal(config.getKey("openai"), "abc");

    const keys = config.getAllKeys();
    assert.equal(keys.openai, "abc");

    config.clearKey("openai");
    assert.equal(config.getKey("openai"), "");
  } finally {
    config.clear();
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});
