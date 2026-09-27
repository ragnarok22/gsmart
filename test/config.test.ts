import "../test-support/setup-env";

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateApiKey } from "../src/utils/config.ts";
import {
  isProviderConfigured,
  usesOpenAIOAuth,
} from "../src/utils/provider-config.ts";

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

test("set, get and clear OpenAI OAuth tokens", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const config = await importConfig();
  try {
    const tokens = {
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accountId: "account-id",
      expiresAt: Date.now() + 1000,
    };

    config.setOpenAIOAuthTokens(tokens);

    assert.deepEqual(config.getOpenAIOAuthTokens(), tokens);
    assert.equal(config.getOpenAIAuthMode(), "oauth");

    config.clearOpenAIOAuthTokens();
    assert.equal(config.getOpenAIOAuthTokens(), null);
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

test("OpenAI OAuth tokens return null when stored tokens are incomplete", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const config = await importConfig();
  try {
    config.setOpenAIOAuthTokens({
      idToken: "id-token",
      accessToken: "access-token",
    } as never);

    assert.equal(config.getOpenAIOAuthTokens(), null);
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

test("provider snapshots retain one view while fresh snapshots reflect credentials and token refreshes", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const config = await importConfig();
  try {
    const empty = config.getProviderSnapshot();
    assert.equal(empty.getDefaultProvider(), undefined);
    assert.equal(empty.getModel("custom"), "");
    assert.equal(empty.getKey("openai"), "");
    assert.equal(empty.getCustomBaseURL(), "");
    assert.equal(empty.getOpenAIAuthMode(), "api-key");
    assert.equal(empty.getOpenAIOAuthTokens(), null);
    assert.equal(usesOpenAIOAuth(empty), false);
    assert.equal(isProviderConfigured("openai", empty), false);
    assert.equal(isProviderConfigured("custom", empty), false);

    config.setDefaultProvider("custom");
    config.setModel("custom", "local-model");
    config.setCustomBaseURL("http://localhost:1234/v1");
    config.setOpenAIOAuthTokens({ accessToken: "incomplete" } as never);
    let snapshot = config.getProviderSnapshot();
    assert.equal(snapshot.getDefaultProvider(), "custom");
    assert.equal(snapshot.getModel("custom"), "local-model");
    assert.equal(snapshot.getCustomBaseURL(), "http://localhost:1234/v1");
    assert.equal(
      isProviderConfigured("custom", snapshot),
      true,
      "keyless custom endpoint is configured",
    );
    assert.equal(snapshot.getOpenAIOAuthTokens(), null);
    assert.equal(
      usesOpenAIOAuth(snapshot),
      true,
      "explicit OAuth mode takes precedence",
    );
    assert.equal(
      isProviderConfigured("openai", snapshot),
      false,
      "incomplete tokens cannot authenticate",
    );

    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "id",
    };
    config.setOpenAIOAuthTokens(tokens);
    config.setOpenAIAuthMode("api-key");
    snapshot = config.getProviderSnapshot();
    assert.deepEqual(snapshot.getOpenAIOAuthTokens(), tokens);
    assert.equal(
      usesOpenAIOAuth(snapshot),
      true,
      "tokens without an API key fall back to OAuth",
    );
    assert.equal(isProviderConfigured("openai", snapshot), true);

    config.setKey("openai", "hosted-key");
    const apiKeySnapshot = config.getProviderSnapshot();
    assert.equal(apiKeySnapshot.getKey("openai"), "hosted-key");
    assert.equal(usesOpenAIOAuth(apiKeySnapshot), false);
    assert.equal(isProviderConfigured("openai", apiKeySnapshot), true);

    const refreshed = {
      ...tokens,
      accessToken: "new-access",
      refreshToken: "new-refresh",
    };
    config.setOpenAIOAuthTokens(refreshed);
    const fresh = config.getProviderSnapshot();
    assert.deepEqual(fresh.getOpenAIOAuthTokens(), refreshed);
    assert.deepEqual(
      config.getOpenAIOAuthTokens(),
      refreshed,
      "normal reads remain live",
    );
    assert.equal(usesOpenAIOAuth(fresh), true);
    assert.deepEqual(snapshot.getOpenAIOAuthTokens(), tokens);
    assert.equal(apiKeySnapshot.getOpenAIAuthMode(), "api-key");
    assert.equal(empty.getDefaultProvider(), undefined);

    config.clearOpenAIOAuthTokens();
    config.clearCustomEndpoint();
    const cleared = config.getProviderSnapshot();
    assert.equal(cleared.getOpenAIOAuthTokens(), null);
    assert.equal(cleared.getDefaultProvider(), undefined);
    assert.equal(isProviderConfigured("custom", cleared), false);
  } finally {
    config.clear();
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir) process.env.GSMART_CONFIG_DIR = previousDir;
    else delete process.env.GSMART_CONFIG_DIR;
  }
});

test("setOpenAIAuthMode stores explicit auth mode", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const config = await importConfig();
  try {
    assert.equal(config.getOpenAIAuthMode(), "api-key");

    config.setOpenAIAuthMode("oauth");
    assert.equal(config.getOpenAIAuthMode(), "oauth");

    config.setOpenAIAuthMode("api-key");
    assert.equal(config.getOpenAIAuthMode(), "api-key");
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

test("welcome shown defaults to false and can be toggled", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "gsmart-config-"));
  const previousDir = process.env.GSMART_CONFIG_DIR;
  process.env.GSMART_CONFIG_DIR = configDir;
  const config = await importConfig();
  try {
    assert.equal(config.getWelcomeShown(), false);

    config.setWelcomeShown(true);
    assert.equal(config.getWelcomeShown(), true);

    config.setWelcomeShown(false);
    assert.equal(config.getWelcomeShown(), false);
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
