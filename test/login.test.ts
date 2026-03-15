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
        if (opts.name === "key") return { key: "sk-test-123" };
        return {};
      },
      "../src/utils/config.ts": {
        default: {
          setKey: (provider: string, key: string) => {
            storedProvider = provider;
            storedKey = key;
          },
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
        default: { setKey: () => {} },
      },
    })
  ).default;

  assert.equal(LoginCommand.name, "login");
  assert.equal(typeof LoginCommand.description, "string");
  assert.equal(typeof LoginCommand.action, "function");
});
