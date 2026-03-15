import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
} from "../src/utils/constants.ts";
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


test("generateCommitMessage falls back to default timeout for invalid GSMART_TIMEOUT", async () => {
  const originalTimeout = process.env.GSMART_TIMEOUT;
  process.env.GSMART_TIMEOUT = "not-a-number";

  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff content");

  assert.deepStrictEqual(capturedOptions().timeout, {
    totalMs: DEFAULT_TIMEOUT_MS,
  });

  if (originalTimeout === undefined) {
    delete process.env.GSMART_TIMEOUT;
  } else {
    process.env.GSMART_TIMEOUT = originalTimeout;
  }
});

test("generateCommitMessage falls back to default timeout for zero GSMART_TIMEOUT", async () => {
  const originalTimeout = process.env.GSMART_TIMEOUT;
  process.env.GSMART_TIMEOUT = "0";

  const { AIBuilder, capturedOptions } = await buildMockedAI();

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff content");

  assert.deepStrictEqual(capturedOptions().timeout, {
    totalMs: DEFAULT_TIMEOUT_MS,
  });

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
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  assert.ok((result as { error: string }).error.includes("Request timed out"));
  assert.ok((result as { error: string }).error.includes("check your network"));
});

test("generateCommitMessage returns {error} on generic failure", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        throw new Error("Something went wrong");
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
    (result as { error: string }).error.includes("Something went wrong"),
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
      validateApiKey: () => null,
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
  let generateTextCalled = false;
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        generateTextCalled = true;
        return { text: "feat: test" };
      },
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
  assert.equal(
    generateTextCalled,
    false,
    "generateText should not be called when API key is missing",
  );
});

test("generateCommitMessage returns error when API key has wrong prefix", async () => {
  let generateTextCalled = false;
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        generateTextCalled = true;
        return { text: "feat: test" };
      },
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
  assert.equal(
    generateTextCalled,
    false,
    "generateText should not be called when API key has wrong prefix",
  );
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
      validateApiKey: () => null,
    },
  });

  const builder = new AIBuilder("mistral", "");
  await builder.generateCommitMessage("main", "diff");

  assert.equal(capturedProvider, "mistral");
});

// ===========================================================================
// Error classification
// ===========================================================================

async function buildMockedAIWithError(errorFactory: () => unknown) {
  const realAI = await import("ai");
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      ...realAI,
      generateText: async () => {
        throw errorFactory();
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });
  return { AIBuilder };
}

test("returns auth error for APICallError with status 401", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "Unauthorized",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 401,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Invalid API key"));
  assert.ok(error.includes("gsmart login"));
});

test("returns auth error for APICallError with status 403", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "Forbidden",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 403,
      }),
  );

  const builder = new AIBuilder("anthropic", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Invalid API key"));
  assert.ok(error.startsWith("anthropic"));
});

test("returns rate limit error for APICallError with status 429", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "Too Many Requests",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Rate limited"));
  assert.ok(error.includes("Wait a moment"));
});

test("returns model unavailable error for APICallError with status 404", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "Not Found",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 404,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("not available"));
  assert.ok(error.includes("try a different provider"));
});

test("returns model unavailable error for NoSuchModelError", async () => {
  const { NoSuchModelError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new NoSuchModelError({
        modelId: "gpt-99",
        modelType: "languageModel",
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes('Model "gpt-99"'));
  assert.ok(error.includes("not available"));
});

test("returns malformed response error for EmptyResponseBodyError", async () => {
  const { EmptyResponseBodyError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () => new EmptyResponseBodyError(),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Unexpected response"));
});

test("returns malformed response error for InvalidResponseDataError", async () => {
  const { InvalidResponseDataError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () => new InvalidResponseDataError({ data: { bad: "data" } }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Unexpected response"));
});

test("returns malformed response error for JSONParseError", async () => {
  const { JSONParseError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () => new JSONParseError({ text: "not json", cause: new Error("parse") }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Unexpected response"));
});

test("returns malformed response error for NoContentGeneratedError", async () => {
  const { NoContentGeneratedError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () => new NoContentGeneratedError(),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Unexpected response"));
});

test("returns network error for TypeError with fetch failed message", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new TypeError("fetch failed"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.includes("internet connection"));
});

test("returns original message for non-network TypeError", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new TypeError("Cannot read properties of undefined (reading 'foo')"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Cannot read properties of undefined"));
  assert.ok(!error.includes("Could not reach"));
});

test("returns original message for TypeError from invalid SDK response", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new TypeError("Expected string but received object"),
  );

  const builder = new AIBuilder("anthropic", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Expected string but received object"));
  assert.ok(error.startsWith("anthropic"));
  assert.ok(!error.includes("internet connection"));
});

test("returns network error for ECONNREFUSED", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new Error("connect ECONNREFUSED 127.0.0.1:443"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
});

test("returns network error for APICallError without status code wrapping fetch failure", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "fetch failed",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: undefined as unknown as number,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.includes("internet connection"));
});

test("returns network error for APICallError without status code wrapping ECONNREFUSED", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "connect ECONNREFUSED 127.0.0.1:443",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: undefined as unknown as number,
      }),
  );

  const builder = new AIBuilder("google", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.startsWith("google"));
});

test("returns network error for APICallError without status code wrapping ENOTFOUND", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "getaddrinfo ENOTFOUND api.openai.com",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: undefined as unknown as number,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.includes("internet connection"));
});

test("returns network error for APICallError without status code wrapping DNS failure", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "dns resolution failed",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: undefined as unknown as number,
      }),
  );

  const builder = new AIBuilder("mistral", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.startsWith("mistral"));
});

test("returns network error for APICallError without status code wrapping network error", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "network error occurred",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: undefined as unknown as number,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.includes("internet connection"));
});

test("returns generic HTTP unknown for APICallError without status code and non-network message", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "unexpected internal error",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: undefined as unknown as number,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("HTTP unknown"));
  assert.ok(error.includes("Please try again"));
});

test("returns generic HTTP error for other status codes", async () => {
  const { APICallError } = await import("ai");
  const { AIBuilder } = await buildMockedAIWithError(
    () =>
      new APICallError({
        message: "Internal Server Error",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 500,
      }),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("HTTP 500"));
  assert.ok(error.includes("Please try again"));
});

test("returns network error for ENOTFOUND plain Error", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new Error("getaddrinfo ENOTFOUND api.openai.com"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.includes("internet connection"));
});

test("returns network error for DNS failure plain Error", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new Error("dns resolution failed"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
});

test("returns network error for generic network keyword in Error", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new Error("network request failed"),
  );

  const builder = new AIBuilder("anthropic", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
  assert.ok(error.startsWith("anthropic"));
});

test("returns network error for fetch failed plain Error", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new Error("fetch failed"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 1,
  });

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("Could not reach"));
});

test("returns generic error for non-network plain Error", async () => {
  const { AIBuilder } = await buildMockedAIWithError(
    () => new Error("some random failure"),
  );

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff");

  assert.equal(typeof result, "object");
  const error = (result as { error: string }).error;
  assert.ok(error.includes("some random failure"));
  assert.ok(!error.includes("Could not reach"));
});

// ===========================================================================
// Retryable error detection
// ===========================================================================

async function getIsRetryableError() {
  const mod = await esmock("../src/utils/ai.ts", {
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });
  return mod.isRetryableError as (error: unknown) => boolean;
}

test("isRetryableError returns true for AbortError", async () => {
  const isRetryableError = await getIsRetryableError();
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for APICallError with status 429", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Too Many Requests",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
  });
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for APICallError with status 500", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Internal Server Error",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 500,
  });
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for APICallError with status 502", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Bad Gateway",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 502,
  });
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for APICallError with status 503", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Service Unavailable",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 503,
  });
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for APICallError without status and fetch failed", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "fetch failed",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: undefined as unknown as number,
  });
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for APICallError without status and ECONNREFUSED", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "connect ECONNREFUSED 127.0.0.1:443",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: undefined as unknown as number,
  });
  assert.equal(isRetryableError(err), true);
});

test("isRetryableError returns true for TypeError with network keyword", async () => {
  const isRetryableError = await getIsRetryableError();
  assert.equal(isRetryableError(new TypeError("fetch failed")), true);
});

test("isRetryableError returns false for non-network TypeError", async () => {
  const isRetryableError = await getIsRetryableError();
  assert.equal(
    isRetryableError(new TypeError("Expected string but received object")),
    false,
  );
  assert.equal(
    isRetryableError(
      new TypeError("Cannot read properties of undefined (reading 'foo')"),
    ),
    false,
  );
});

test("isRetryableError returns false for TypeError with empty message", async () => {
  const isRetryableError = await getIsRetryableError();
  assert.equal(isRetryableError(new TypeError("")), false);
  assert.equal(isRetryableError(new TypeError()), false);
});

test("isRetryableError returns true for plain Error with network keyword", async () => {
  const isRetryableError = await getIsRetryableError();
  assert.equal(
    isRetryableError(new Error("connect ECONNREFUSED 127.0.0.1:443")),
    true,
  );
  assert.equal(
    isRetryableError(new Error("getaddrinfo ENOTFOUND api.openai.com")),
    true,
  );
  assert.equal(isRetryableError(new Error("fetch failed")), true);
});

test("isRetryableError returns false for APICallError with status 401", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Unauthorized",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 401,
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for APICallError with status 403", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Forbidden",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 403,
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for APICallError with status 400", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Bad Request",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for APICallError with status 404", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "Not Found",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 404,
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for NoSuchModelError", async () => {
  const { NoSuchModelError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new NoSuchModelError({
    modelId: "gpt-99",
    modelType: "languageModel",
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for EmptyResponseBodyError", async () => {
  const { EmptyResponseBodyError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  assert.equal(isRetryableError(new EmptyResponseBodyError()), false);
});

test("isRetryableError returns false for InvalidResponseDataError", async () => {
  const { InvalidResponseDataError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new InvalidResponseDataError({
    data: {},
    message: "invalid data",
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for JSONParseError", async () => {
  const { JSONParseError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new JSONParseError({ text: "{bad", message: "parse error" });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for NoContentGeneratedError", async () => {
  const { NoContentGeneratedError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  assert.equal(isRetryableError(new NoContentGeneratedError()), false);
});

test("isRetryableError returns false for APICallError without status and non-network message", async () => {
  const { APICallError } = await import("ai");
  const isRetryableError = await getIsRetryableError();
  const err = new APICallError({
    message: "unexpected internal error",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: undefined as unknown as number,
  });
  assert.equal(isRetryableError(err), false);
});

test("isRetryableError returns false for generic Error", async () => {
  const isRetryableError = await getIsRetryableError();
  assert.equal(isRetryableError(new Error("some random failure")), false);
});

test("isRetryableError returns false for non-Error values", async () => {
  const isRetryableError = await getIsRetryableError();
  assert.equal(isRetryableError("string error"), false);
  assert.equal(isRetryableError(42), false);
  assert.equal(isRetryableError(null), false);
});

// ===========================================================================
// Retry behavior
// ===========================================================================

const noDelay = async () => {};

async function buildRetryAI(
  generateTextFake: (
    opts: Record<string, unknown>,
  ) => Promise<{ text: string }>,
) {
  let callCount = 0;

  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async (opts: Record<string, unknown>) => {
        callCount++;
        return generateTextFake(opts);
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
      validateApiKey: () => null,
    },
  });

  return { AIBuilder, getCallCount: () => callCount };
}

test("retries and succeeds after transient 500 errors", async () => {
  const { APICallError } = await import("ai");
  let callCount = 0;

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    callCount++;
    if (callCount <= 2) {
      throw new APICallError({
        message: "Internal Server Error",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 500,
      });
    }
    return { text: "feat: recovered" };
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(result, "feat: recovered");
  assert.equal(getCallCount(), 3);
});

test("calls onRetry callback on each retry with correct args", async () => {
  const { APICallError } = await import("ai");
  let callCount = 0;
  const retryCalls: [number, number][] = [];

  const { AIBuilder } = await buildRetryAI(async () => {
    callCount++;
    if (callCount <= 2) {
      throw new APICallError({
        message: "Internal Server Error",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 500,
      });
    }
    return { text: "feat: recovered" };
  });

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
    onRetry: (attempt: number, maxRetries: number) => {
      retryCalls.push([attempt, maxRetries]);
    },
  });

  assert.equal(retryCalls.length, 2);
  assert.deepStrictEqual(retryCalls[0], [1, DEFAULT_MAX_RETRIES]);
  assert.deepStrictEqual(retryCalls[1], [2, DEFAULT_MAX_RETRIES]);
});

test("does not retry non-retryable errors", async () => {
  const { APICallError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new APICallError({
      message: "Unauthorized",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
    });
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok((result as { error: string }).error.includes("Invalid API key"));
  assert.equal(getCallCount(), 1);
});

test("exhausts all retries and returns error", async () => {
  const { APICallError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new APICallError({
      message: "Internal Server Error",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 500,
    });
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok((result as { error: string }).error.includes("HTTP 500"));
  assert.equal(getCallCount(), DEFAULT_MAX_RETRIES);
});

test("retries AbortError then succeeds", async () => {
  let callCount = 0;

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    callCount++;
    if (callCount === 1) {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    }
    return { text: "feat: timeout recovered" };
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(result, "feat: timeout recovered");
  assert.equal(getCallCount(), 2);
});

test("retries network error then succeeds", async () => {
  let callCount = 0;

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    callCount++;
    if (callCount === 1) {
      throw new Error("connect ECONNREFUSED 127.0.0.1:443");
    }
    return { text: "feat: network recovered" };
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(result, "feat: network recovered");
  assert.equal(getCallCount(), 2);
});

test("retries 429 rate limit then succeeds", async () => {
  const { APICallError } = await import("ai");
  let callCount = 0;

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    callCount++;
    if (callCount === 1) {
      throw new APICallError({
        message: "Too Many Requests",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
      });
    }
    return { text: "feat: rate limit recovered" };
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(result, "feat: rate limit recovered");
  assert.equal(getCallCount(), 2);
});

test("does not retry NoSuchModelError", async () => {
  const { NoSuchModelError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new NoSuchModelError({
      modelId: "gpt-99",
      modelType: "languageModel",
    });
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok((result as { error: string }).error.includes("not available"));
  assert.equal(getCallCount(), 1);
});

test("calls delayFn with correct exponential backoff values", async () => {
  const { APICallError } = await import("ai");
  let callCount = 0;
  const delays: number[] = [];

  const { AIBuilder } = await buildRetryAI(async () => {
    callCount++;
    if (callCount <= 2) {
      throw new APICallError({
        message: "Internal Server Error",
        url: "https://api.openai.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 500,
      });
    }
    return { text: "feat: recovered" };
  });

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff", {
    delayFn: async (ms: number) => {
      delays.push(ms);
    },
  });

  assert.deepStrictEqual(delays, [1000, 2000]);
});

test("default maxRetries is DEFAULT_MAX_RETRIES", async () => {
  const { APICallError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new APICallError({
      message: "Internal Server Error",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 500,
    });
  });

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(getCallCount(), DEFAULT_MAX_RETRIES);
});

test("does not retry non-network TypeError", async () => {
  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new TypeError("Expected string but received object");
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes(
      "Expected string but received object",
    ),
  );
  assert.equal(getCallCount(), 1);
});

test("retries network TypeError then succeeds", async () => {
  let callCount = 0;

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    callCount++;
    if (callCount === 1) {
      throw new TypeError("fetch failed");
    }
    return { text: "feat: fetch recovered" };
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(result, "feat: fetch recovered");
  assert.equal(getCallCount(), 2);
});

test("does not retry EmptyResponseBodyError", async () => {
  const { EmptyResponseBodyError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new EmptyResponseBodyError();
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes("Unexpected response"),
  );
  assert.equal(getCallCount(), 1);
});

test("does not retry InvalidResponseDataError", async () => {
  const { InvalidResponseDataError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new InvalidResponseDataError({
      data: {},
      message: "invalid data",
    });
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes("Unexpected response"),
  );
  assert.equal(getCallCount(), 1);
});

test("does not retry JSONParseError", async () => {
  const { JSONParseError } = await import("ai");

  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new JSONParseError({ text: "{bad", message: "parse error" });
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes("Unexpected response"),
  );
  assert.equal(getCallCount(), 1);
});

test("does not retry non-network plain Error", async () => {
  const { AIBuilder, getCallCount } = await buildRetryAI(async () => {
    throw new Error("some random failure");
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: noDelay,
  });

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes("some random failure"),
  );
  assert.equal(getCallCount(), 1);
});
