import "../test-support/setup-env";

import { describe, it } from "node:test";
import assert from "node:assert";
import { providers, getActiveProviders } from "../src/utils/providers";

describe("providers", () => {
  it("exports a list of providers", () => {
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);
  });

  it("all providers have required fields", () => {
    for (const provider of providers) {
      assert.ok(provider.title);
      assert.ok(provider.value);
      assert.ok(provider.description);
      assert.ok(typeof provider.active === "boolean");
    }
  });

  it("getActiveProviders returns only active providers", () => {
    const active = getActiveProviders();
    assert.ok(Array.isArray(active));

    for (const provider of active) {
      assert.strictEqual(provider.active, true);
    }
  });

  it("getActiveProviders includes all currently active providers", () => {
    const active = getActiveProviders();
    const expectedProviders = [
      "openai",
      "anthropic",
      "google",
      "mistral",
      "fireworks",
      "plataformia",
    ];

    for (const providerValue of expectedProviders) {
      const found = active.find((p) => p.value === providerValue);
      assert.ok(found, `Provider ${providerValue} should be active`);
    }
  });

  it("providers have correct structure", () => {
    const openai = providers.find((p) => p.value === "openai");
    assert.ok(openai);
    assert.strictEqual(openai.title, "OpenAI");
    assert.strictEqual(openai.value, "openai");
    assert.ok(openai.description.includes("OpenAI"));
    assert.strictEqual(openai.active, true);
  });
});
