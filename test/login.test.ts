import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { createLoginCommand } from "../src/commands/login.ts";

const activeProviders = [
  { title: "OpenAI", value: "openai", description: "OpenAI", active: true },
  {
    title: "Anthropic",
    value: "anthropic",
    description: "Anthropic",
    active: true,
  },
] as const;

const createSpinner = (messages: string[]) => {
  const spinner = {
    start: () => spinner,
    fail: (message: string) => {
      messages.push(stripVTControlCharacters(message));
      return spinner;
    },
    succeed: (message: string) => {
      messages.push(stripVTControlCharacters(message));
      return spinner;
    },
  };
  return spinner;
};

test("login stores API key for selected provider", async () => {
  let storedProvider = "";
  let storedKey = "";
  let authMode = "";
  const messages: string[] = [];

  const LoginCommand = createLoginCommand({
    providers: [...activeProviders],
    spinner: () => createSpinner(messages) as never,
    prompt: async (opts: { name: string }) => {
      if (opts.name === "provider") return { provider: "openai" };
      if (opts.name === "authMethod") return { authMethod: "api-key" };
      if (opts.name === "key") return { key: "sk-test-123" };
      return {};
    },
    config: {
      setKey: (provider: string, key: string) => {
        storedProvider = provider;
        storedKey = key;
      },
      setOpenAIAuthMode: (mode: "api-key" | "oauth") => {
        authMode = mode;
      },
      setOpenAIOAuthTokens: () => undefined,
    },
  });

  await LoginCommand.action({});

  assert.equal(storedProvider, "openai");
  assert.equal(storedKey, "sk-test-123");
  assert.equal(authMode, "api-key");
  assert.deepEqual(messages, ["API key saved successfully"]);
});

test("login aborts when no provider selected", async () => {
  let setKeyCalled = false;
  const messages: string[] = [];

  const LoginCommand = createLoginCommand({
    providers: [...activeProviders],
    spinner: () => createSpinner(messages) as never,
    prompt: async () => ({ provider: undefined }),
    config: {
      setKey: () => {
        setKeyCalled = true;
      },
      setOpenAIAuthMode: () => undefined,
      setOpenAIOAuthTokens: () => undefined,
    },
  });

  await LoginCommand.action({});

  assert.equal(setKeyCalled, false);
  assert.deepEqual(messages, ["No provider selected"]);
});

test("login aborts when no API key provided", async () => {
  let setKeyCalled = false;
  const messages: string[] = [];

  const LoginCommand = createLoginCommand({
    providers: [...activeProviders],
    spinner: () => createSpinner(messages) as never,
    prompt: async (opts: { name: string }) => {
      if (opts.name === "provider") return { provider: "anthropic" };
      if (opts.name === "key") return { key: undefined };
      return {};
    },
    config: {
      setKey: () => {
        setKeyCalled = true;
      },
      setOpenAIAuthMode: () => undefined,
      setOpenAIOAuthTokens: () => undefined,
    },
  });

  await LoginCommand.action({});

  assert.equal(setKeyCalled, false);
  assert.deepEqual(messages, ["No API key provided"]);
});

test("login command has correct metadata", () => {
  const LoginCommand = createLoginCommand();

  assert.equal(LoginCommand.name, "login");
  assert.equal(typeof LoginCommand.description, "string");
  assert.equal(typeof LoginCommand.action, "function");
});

test("login stores ChatGPT OAuth tokens for OpenAI", async () => {
  let storedTokens: unknown;
  const messages: string[] = [];

  const LoginCommand = createLoginCommand({
    providers: [...activeProviders],
    spinner: () => createSpinner(messages) as never,
    prompt: async (opts: { name: string }) => {
      if (opts.name === "provider") return { provider: "openai" };
      if (opts.name === "authMethod") return { authMethod: "oauth" };
      return {};
    },
    loginWithOpenAIOAuth: async () => ({
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accountId: "account-id",
    }),
    config: {
      setOpenAIOAuthTokens: (tokens: unknown) => {
        storedTokens = tokens;
      },
      setKey: () => undefined,
      setOpenAIAuthMode: () => undefined,
    },
  });

  await LoginCommand.action({});

  assert.deepEqual(storedTokens, {
    idToken: "id-token",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accountId: "account-id",
  });
  assert.deepEqual(messages, ["ChatGPT login saved successfully"]);
});
