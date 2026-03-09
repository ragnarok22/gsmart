import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";
import { DEFAULT_TIMEOUT_MS } from "../src/utils/constants.ts";

test("generateCommitMessage passes default timeout to generateText", async () => {
  let capturedOptions: Record<string, unknown> = {};

  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async (opts: Record<string, unknown>) => {
        capturedOptions = opts;
        return { text: "feat: test" };
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
    },
  });

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff content");

  assert.deepStrictEqual(capturedOptions.timeout, {
    totalMs: DEFAULT_TIMEOUT_MS,
  });
});

test("generateCommitMessage respects GSMART_TIMEOUT env var", async () => {
  const originalTimeout = process.env.GSMART_TIMEOUT;
  process.env.GSMART_TIMEOUT = "15000";

  let capturedOptions: Record<string, unknown> = {};

  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async (opts: Record<string, unknown>) => {
        capturedOptions = opts;
        return { text: "feat: test" };
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
    },
  });

  const builder = new AIBuilder("openai", "");
  await builder.generateCommitMessage("main", "diff content");

  assert.deepStrictEqual(capturedOptions.timeout, { totalMs: 15000 });

  if (originalTimeout === undefined) {
    delete process.env.GSMART_TIMEOUT;
  } else {
    process.env.GSMART_TIMEOUT = originalTimeout;
  }
});

test("generateCommitMessage returns friendly error on timeout", async () => {
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
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff content");

  assert.equal(typeof result, "object");
  assert.ok((result as { error: string }).error.includes("Request timed out"));
  assert.ok((result as { error: string }).error.includes("check your network"));
});

test("generateCommitMessage still handles non-timeout errors", async () => {
  const { AIBuilder } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        throw new Error("API rate limit exceeded");
      },
    },
    "../src/utils/config.ts": {
      default: { getKey: () => "fake-key" },
    },
  });

  const builder = new AIBuilder("openai", "");
  const result = await builder.generateCommitMessage("main", "diff content");

  assert.equal(typeof result, "object");
  assert.ok(
    (result as { error: string }).error.includes("API rate limit exceeded"),
  );
});
