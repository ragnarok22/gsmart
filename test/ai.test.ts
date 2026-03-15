import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";
import { DEFAULT_TIMEOUT_MS } from "../src/utils/constants.ts";
import type { Provider } from "../src/definitions.ts";

// ---------------------------------------------------------------------------
// Helper: create an esmock'd AIBuilder with a fake generateText and config
// ---------------------------------------------------------------------------
async function buildMockedAI(
  generateTextFake: (
    opts: Record<string, unknown>,
  ) => Promise<{ text: string }> = async () => ({
    text: "feat: test",
  }),
) {
  let capturedOptions: Record<string, unknown> = {};

  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async (opts: Record<string, unknown>) => {
        capturedOptions = opts;
        return generateTextFake(opts);
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  return { AIBuilder, capturedOptions: () => capturedOptions };
}

// ===========================================================================
// Timeout handling (existing tests)
// ===========================================================================

test("generateCommitMessage passes default timeout to generateText", async () => {
  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff content");

  assert.deepStrictEqual(capturedOptions().timeout, {
    totalMs: DEFAULT_TIMEOUT_MS,
  });
});

test("generateCommitMessage respects GSMART_TIMEOUT env var", async () => {
  const originalTimeout = process.env.GSMART_TIMEOUT;
  process.env.GSMART_TIMEOUT = "15000";

  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff content");

  assert.deepStrictEqual(capturedOptions().timeout, { totalMs: 15000 });

  if (originalTimeout === undefined) {
    delete process.env.GSMART_TIMEOUT;
  } else {
    process.env.GSMART_TIMEOUT = originalTimeout;
  }
});

// ===========================================================================
// Return type contract: string | {error: string}
// ===========================================================================

test("generateCommitMessage returns a string on success", async () => {
  const { AIBuilder } = await buildMockedAI(async () => ({
    text: "feat(auth): add OAuth login",
  }));

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "string");
  assert.equal(result, "feat(auth): add OAuth login");
});

test("generateCommitMessage returns {error} on timeout", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  assert.ok((result as { error: string }).error.includes("Request timed out"));
  assert.ok((result as { error: string }).error.includes("check your network"));
});

test("generateCommitMessage returns {error} on generic failure", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        throw new Error("API rate limit exceeded");
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes("API rate limit exceeded"),
  );
});

// ===========================================================================
// Error handling scenarios
// ===========================================================================

test("error includes provider name in message", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        throw new Error("Unauthorized");
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "bad-key" },
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("anthropic", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.startsWith("anthropic"));
  assert.ok(error.includes("Unauthorized"));
});

test("handles non-Error thrown values gracefully", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        throw "string error";
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes(
      "An error occurred while generating the commit message",
    ),
  );
});

test("handles Error with empty message", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        throw new Error("");
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes(
      "An error occurred while generating the commit message",
    ),
  );
});

// ===========================================================================
// Provider configuration
// ===========================================================================

test("each provider creates the correct model", async () => {
  const providerModels: Record<string, { model: string; baseURL?: string }> = {
    openai: { model: "gpt-5-codex" },
    anthropic: { model: "claude-3-5-haiku-latest" },
    google: { model: "gemini-2.0-flash" },
    mistral: { model: "mistral-large-latest" },
    fireworks: {
      model: "accounts/fireworks/models/firefunction-v1",
      baseURL: "https://api.fireworks.ai/inference/v1",
    },
    plataformia: {
      model: "radiance",
      baseURL: "https://apigateway.avangenio.net",
    },
  };

  for (const [provider, expected] of Object.entries(providerModels)) {
    let capturedModelId = "";
    let capturedBaseURL: string | undefined;

    const createFake =
      (isOpenAICompat: boolean) =>
      (opts: { apiKey?: string; baseURL?: string }) => {
        if (isOpenAICompat) capturedBaseURL = opts.baseURL;
        return (modelId: string) => {
          capturedModelId = modelId;
          return { modelId };
        };
      };

    const { AIBuilder } = await esmock("../src/utils/ai.ts", {
      "@ai-sdk/openai": { createOpenAI: createFake(true) },
      "@ai-sdk/anthropic": { createAnthropic: createFake(false) },
      "@ai-sdk/google": { createGoogleGenerativeAI: createFake(false) },
      "@ai-sdk/mistral": { createMistral: createFake(false) },
      ai: {
        generateText: async () => ({ text: "feat: test" }),
      },
      "../src/utils/config.ts": {
        default: { getKey: () => "fake-key" },
        validateApiKey: () => null,
      },
    });

    const builder = new AIBuilder(provider as Provider, "");
    await builder.generateCommitMessage("main", "diff");

    assert.equal(
      capturedModelId,
      expected.model,
      `${provider} should use model ${expected.model}`,
    );

    if (expected.baseURL) {
      assert.equal(
        capturedBaseURL,
        expected.baseURL,
        `${provider} should use baseURL ${expected.baseURL}`,
      );
    }
  }
});

test("invalid provider throws an error", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => ({ text: "feat: test" }),
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("invalid-provider" as Provider, "");
  assert.throws(() => builder.generateCommitMessage("main", "diff"), {
    message: "Invalid provider",
  });
});

// ===========================================================================
// Prompt construction
// ===========================================================================

test("generates default prompt when no custom prompt provided", async () => {
  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("feature-branch", "added new file");

  const prompt = capturedOptions().prompt as string;
  assert.ok(prompt.includes("feature-branch"));
  assert.ok(prompt.includes("added new file"));
  assert.ok(!prompt.includes("Additional instructions"));
});

test("appends custom prompt as additional instructions", async () => {
  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "Keep it under 50 characters");
  await builder.generateCommitMessage("main", "diff content");

  const prompt = capturedOptions().prompt as string;
  assert.ok(prompt.includes("Additional instructions"));
  assert.ok(prompt.includes("Keep it under 50 characters"));
});

test("system prompt contains conventional commits instruction", async () => {
  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff");

  const system = capturedOptions().system as string;
  assert.ok(system.includes("Conventional Commits"));
});

test("prompt includes branch name and changes", async () => {
  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("fix/login-bug", "+ const x = 1;");

  const prompt = capturedOptions().prompt as string;
  assert.ok(prompt.includes("fix/login-bug"));
  assert.ok(prompt.includes("+ const x = 1;"));
});

// ===========================================================================
// Constructor and changeProvider
// ===========================================================================

test("constructor sets provider and prompt", async () => {
  const { AIBuilder } = await buildMockedAI();

  const builder = new AIBuilder("anthropic", "be concise");
  assert.equal(builder.provider, "anthropic");
  assert.equal(builder.prompt, "be concise");
});

test("defaults to DEFAULT_PROVIDER when none specified", async () => {
  const { AIBuilder } = await buildMockedAI();

  const builder = new AIBuilder(undefined, "");
  assert.equal(builder.provider, "openai");
});

test("changeProvider updates the provider", async () => {
  const { AIBuilder } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  assert.equal(builder.provider, "openai");

  builder.changeProvider("google");
  assert.equal(builder.provider, "google");
});

test("changeProvider affects subsequent generateCommitMessage calls", async () => {
  let capturedModelId = "";

  const createFake = () => () => {
    return (modelId: string) => {
      capturedModelId = modelId;
      return { modelId };
    };
  };

  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    "@ai-sdk/openai": { createOpenAI: createFake() },
    "@ai-sdk/anthropic": { createAnthropic: createFake() },
    "@ai-sdk/google": { createGoogleGenerativeAI: createFake() },
    "@ai-sdk/mistral": { createMistral: createFake() },
    ai: {
      generateText: async () => ({ text: "feat: test" }),
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
    },
  });

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff");
  assert.equal(capturedModelId, "gpt-5-codex");

  builder.changeProvider("google");
  await builder.generateCommitMessage("main", "diff");
  assert.equal(capturedModelId, "gemini-2.0-flash");
});

// ===========================================================================
// API key validation
// ===========================================================================

test("generateCommitMessage returns error when API key is missing", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => ({ text: "feat: test" }),
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "" },
      validateApiKey: (await import("../src/utils/config.ts")).validateApiKey,
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("No API key found"));
  assert.ok(error.includes("gsmart login"));
});

test("generateCommitMessage returns error when API key has wrong prefix", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => ({ text: "feat: test" }),
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "wrong-prefix-key-1234567890" },
      validateApiKey: (await import("../src/utils/config.ts")).validateApiKey,
    },
  });

  const builder = new AIBuilder("anthropic", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("unexpected format"));
  assert.ok(error.includes("gsmart login"));
});

test("generateCommitMessage proceeds when API key is valid", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => ({ text: "feat: valid key" }),
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "sk-1234567890abcdef" },
      validateApiKey: (await import("../src/utils/config.ts")).validateApiKey,
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "string");
  assert.equal(result, "feat: valid key");
});

// ===========================================================================
// API key retrieval
// ===========================================================================

test("passes correct provider to config.getKey", async () => {
  let capturedProvider = "";

  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => ({ text: "feat: test" }),
    },
    "../src/utils/config.ts": {
      default: {
        getKey: (provider: string) => {
          capturedProvider = provider;
          return "fake-key";
        },
      },
    },
  });

  const builder = new AIBuilder("mistral", "");
  await builder.generateCommitMessage("main", "diff");

  assert.equal(capturedProvider, "mistral");
});
