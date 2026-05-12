import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

test("login stores API key for selected provider", async () => {
  let storedProvider = "";
  let storedKey = "";

  const LoginCommand = (
    await esmock("../src/commands/login.ts", {
      prompts: async (opts: { name: string }) => {
        if (opts.name === "provider") return { provider: "openai" };
        if (opts.name === "authMethod") return { authMethod: "api-key" };
        if (opts.name === "key") return { key: "sk-test-123" };
        return {};
      },
      "../src/utils/config.ts": {
        default: {
          setKey: (provider: string, key: string) => {
            storedProvider = provider;
            storedKey = key;
          },
          setOpenAIAuthMode: () => {},
        },
      },
    })
  ).default;

  await LoginCommand.action({});

  assert.equal(storedProvider, "openai");
  assert.equal(storedKey, "sk-test-123");
});

test("login aborts when no provider selected", async () => {
  let setKeyCalled = false;

  const LoginCommand = (
    await esmock("../src/commands/login.ts", {
      prompts: async () => ({ provider: undefined }),
      "../src/utils/config.ts": {
        default: {
          setKey: () => {
            setKeyCalled = true;
          },
          setOpenAIAuthMode: () => {},
        },
      },
    })
  ).default;

  await LoginCommand.action({});

  assert.equal(setKeyCalled, false);
});

test("login aborts when no API key provided", async () => {
  let setKeyCalled = false;

  const LoginCommand = (
    await esmock("../src/commands/login.ts", {
      prompts: async (opts: { name: string }) => {
        if (opts.name === "provider") return { provider: "anthropic" };
        if (opts.name === "key") return { key: undefined };
        return {};
      },
      "../src/utils/config.ts": {
        default: {
          setKey: () => {
            setKeyCalled = true;
          },
          setOpenAIAuthMode: () => {},
        },
      },
    })
  ).default;

  await LoginCommand.action({});

  assert.equal(setKeyCalled, false);
});

test("login command has correct metadata", async () => {
  const LoginCommand = (
    await esmock("../src/commands/login.ts", {
      prompts: async () => ({}),
      "../src/utils/config.ts": {
        default: { setKey: () => {}, setOpenAIAuthMode: () => {} },
      },
    })
  ).default;

  assert.equal(LoginCommand.name, "login");
  assert.equal(typeof LoginCommand.description, "string");
  assert.equal(typeof LoginCommand.action, "function");
});

test("login stores ChatGPT OAuth tokens for OpenAI", async () => {
  let storedTokens: unknown;

  const LoginCommand = (
    await esmock("../src/commands/login.ts", {
      prompts: async (opts: { name: string }) => {
        if (opts.name === "provider") return { provider: "openai" };
        if (opts.name === "authMethod") return { authMethod: "oauth" };
        return {};
      },
      "../src/utils/openai-oauth.ts": {
        loginWithOpenAIOAuth: async () => ({
          idToken: "id-token",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          accountId: "account-id",
        }),
      },
      "../src/utils/config.ts": {
        default: {
          setOpenAIOAuthTokens: (tokens: unknown) => {
            storedTokens = tokens;
          },
          setKey: () => {},
          setOpenAIAuthMode: () => {},
        },
      },
    })
  ).default;

  await LoginCommand.action({});

  assert.deepEqual(storedTokens, {
    idToken: "id-token",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accountId: "account-id",
  });
});
