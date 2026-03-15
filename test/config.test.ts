import "../test-support/setup-env";

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateApiKey } from "../src/utils/config.ts";

const importConfig = async () => {
  // append query to bust module cache
  return (await import("../src/utils/config.ts?" + Date.now())).default;
};

// ===========================================================================
// validateApiKey
// ===========================================================================

test("returns error when API key is empty", () => {
  const result = validateApiKey("openai", "");
  assert.ok(result);
  assert.ok(result.includes("No API key found"));
  assert.ok(result.includes("gsmart login"));
});

test("returns error when API key is whitespace only", () => {
  const result = validateApiKey("anthropic", "   ");
  assert.ok(result);
  assert.ok(result.includes("No API key found"));
});

test("returns error when API key is too short", () => {
  const result = validateApiKey("openai", "sk-short");
  assert.ok(result);
  assert.ok(result.includes("too short"));
  assert.ok(result.includes("gsmart login"));
});

test("returns error when OpenAI key has wrong prefix", () => {
  const result = validateApiKey("openai", "wrong-prefix-key-1234567890");
  assert.ok(result);
  assert.ok(result.includes("unexpected format"));
  assert.ok(result.includes("sk-"));
});

test("returns error when Anthropic key has wrong prefix", () => {
  const result = validateApiKey("anthropic", "wrong-prefix-key-1234567890");
  assert.ok(result);
  assert.ok(result.includes("unexpected format"));
  assert.ok(result.includes("sk-ant-"));
});

test("returns error when Google key has wrong prefix", () => {
  const result = validateApiKey("google", "wrong-prefix-key-1234567890");
  assert.ok(result);
  assert.ok(result.includes("unexpected format"));
  assert.ok(result.includes("AIza"));
});

test("returns null for valid OpenAI key", () => {
  const result = validateApiKey("openai", "sk-1234567890abcdef");
  assert.equal(result, null);
});

test("returns null for valid key with leading/trailing whitespace", () => {
  const result = validateApiKey("openai", "  sk-1234567890abcdef  ");
  assert.equal(result, null);
});

test("returns null for valid Anthropic key", () => {
  const result = validateApiKey("anthropic", "sk-ant-1234567890abcdef");
  assert.equal(result, null);
});

test("returns null for valid Google key", () => {
  const result = validateApiKey("google", "AIza1234567890abcdef");
  assert.equal(result, null);
});

test("returns null for valid Mistral key (no prefix requirement)", () => {
  const result = validateApiKey("mistral", "any-valid-key-1234567890");
  assert.equal(result, null);
});

test("returns null for valid Fireworks key (no prefix requirement)", () => {
  const result = validateApiKey("fireworks", "fw-some-key-1234567890");
  assert.equal(result, null);
});

test("returns null for valid PlataformIA key (no prefix requirement)", () => {
  const result = validateApiKey("plataformia", "plat-key-1234567890");
  assert.equal(result, null);
});

// ===========================================================================
// Config storage
// ===========================================================================

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
