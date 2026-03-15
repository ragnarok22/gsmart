import "../test-support/setup-env";

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import assert from "node:assert/strict";

const importPromptConfig = async () => {
  return await import("../src/utils/prompt-config.ts?" + Date.now());
};

test("getPrompt returns empty string when no prompt is set", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-prompt-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const { getPrompt } = await importPromptConfig();
  try {
    assert.equal(getPrompt(), "");
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});

test("setPrompt persists and getPrompt retrieves it", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-prompt-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const { setPrompt, getPrompt } = await importPromptConfig();
  try {
    setPrompt("use conventional commits");
    assert.equal(getPrompt(), "use conventional commits");
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});

test("clearPrompt returns cleared true when prompt exists", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-prompt-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const { setPrompt, clearPrompt, getPrompt } = await importPromptConfig();
  try {
    setPrompt("my prompt");
    const result = clearPrompt();
    assert.deepEqual(result, { cleared: true });
    assert.equal(getPrompt(), "");
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});

test("clearPrompt returns cleared false when no prompt exists", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-prompt-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const { clearPrompt } = await importPromptConfig();
  try {
    const result = clearPrompt();
    assert.deepEqual(result, { cleared: false });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});

test("hasPrompt returns false when no prompt is set", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-prompt-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const { hasPrompt } = await importPromptConfig();
  try {
    assert.equal(hasPrompt(), false);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});

test("hasPrompt returns true when prompt is set", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-prompt-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const { setPrompt, hasPrompt } = await importPromptConfig();
  try {
    setPrompt("my prompt");
    assert.equal(hasPrompt(), true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) {
      process.env.GSMART_CONFIG_DIR = previousDir;
    } else {
      delete process.env.GSMART_CONFIG_DIR;
    }
  }
});
