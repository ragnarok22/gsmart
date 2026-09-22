import "../test-support/setup-env";
import "../test-support/isolated-config";
import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import config from "../src/utils/config.ts";
import {
  providers,
  defaultModels,
  resolveModel,
  validateBaseURL,
  validateModel,
} from "../src/utils/providers.ts";
import { isProviderConfigured } from "../src/utils/provider-config.ts";
import { createConfigCommand } from "../src/commands/config.ts";
import { createLoginCommand } from "../src/commands/login.ts";
import { createMainCommand } from "../src/commands/main.ts";
import { createProgram } from "../src/program.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import type { GenerationOptions } from "../src/utils/ai.ts";
import type { Provider } from "../src/definitions.ts";

beforeEach(() => config.clear());
afterEach(() => config.clear());

function output() {
  const messages: string[] = [];
  let exitCode = 0;
  const log = (...args: unknown[]) => {
    messages.push(stripVTControlCharacters(args.join(" ")));
  };
  const spinner = {
    start() {
      return this;
    },
    stop() {
      return this;
    },
    fail: log,
    succeed: log,
    warn: log,
    info: log,
    text: "",
  };
  return {
    spinner: (() => spinner) as never,
    log,
    setExitCode: (code: number) => {
      exitCode = code;
    },
    exitCode: () => exitCode,
    text: () => messages.join("\n"),
  };
}

test("preferences persist across processes and clearing custom preserves hosted credentials", async () => {
  config.setDefaultProvider("custom");
  config.setModel("custom", " llama3.2 ");
  config.setModel("anthropic", "claude-test");
  config.setCustomBaseURL("http://localhost:11434/v1/");
  config.setKey("custom", "local-key");
  config.setKey("openai", "hosted-key");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'import config from "./src/utils/config.ts"; console.log(JSON.stringify([config.getDefaultProvider(),config.getModel("custom"),config.getModel("anthropic"),config.getCustomBaseURL()]));',
    ],
    { encoding: "utf8", env: process.env },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    "custom",
    "llama3.2",
    "claude-test",
    "http://localhost:11434/v1",
  ]);
  config.clearCustomEndpoint();
  assert.equal(config.getDefaultProvider(), undefined);
  assert.equal(config.getModel("custom"), "");
  assert.equal(config.getKey("custom"), "");
  assert.equal(config.getCustomBaseURL(), "");
  assert.equal(config.getKey("openai"), "hosted-key");
  assert.equal(config.getModel("anthropic"), "claude-test");
});

test("models resolve explicit > saved > auth-aware built-in and custom has no fallback", () => {
  for (const [provider, fallback] of Object.entries(defaultModels)) {
    assert.equal(
      resolveModel(provider as Provider, "explicit", "saved"),
      "explicit",
    );
    assert.equal(
      resolveModel(provider as Provider, undefined, "saved"),
      "saved",
    );
    assert.equal(resolveModel(provider as Provider), fallback);
  }
  assert.equal(resolveModel("openai", undefined, "", true), "gpt-5-codex");
  assert.equal(resolveModel("openai", "override", "saved", true), "override");
  assert.equal(resolveModel("custom", "local", "saved"), "local");
  assert.throws(() => resolveModel("custom"), /No model configured/);
  assert.throws(() => resolveModel("openai", " ", "saved"), /non-empty/);
});

test("model and endpoint validation accepts local URLs and rejects invalid operation URLs", () => {
  for (const model of ["", "   ", "model\nother", "model\u0000"])
    assert.throws(() => validateModel(model));
  assert.equal(
    validateModel(" accounts/fireworks/models/test "),
    "accounts/fireworks/models/test",
  );
  assert.equal(
    validateBaseURL("http://[::1]:1234/v1/"),
    "http://[::1]:1234/v1",
  );
  for (const url of [
    "",
    "localhost:1234",
    "ftp://host/v1",
    "https://user:secret@host/v1",
    "http://host/v1?key=secret",
    "http://host/#x",
    "http://host/v1/chat/completions",
    "http://host/v1/responses/",
  ]) {
    assert.throws(() => validateBaseURL(url), Error, url);
  }
});

test("configured detection supports keyless endpoints and active OAuth mode", () => {
  config.setCustomBaseURL("http://localhost:1234/v1");
  assert.equal(isProviderConfigured("custom", config), false);
  assert.equal(isProviderConfigured("custom", config, "one-off"), true);
  config.setModel("custom", "local");
  assert.equal(isProviderConfigured("custom", config), true);
  config.setKey("openai", "sk-hosted-key");
  assert.equal(isProviderConfigured("openai", config), true);
  config.setOpenAIAuthMode("oauth");
  assert.equal(isProviderConfigured("openai", config), false);
  config.setOpenAIOAuthTokens({
    accessToken: "access",
    refreshToken: "refresh",
    idToken: "id",
  });
  assert.equal(isProviderConfigured("openai", config), true);
});

test("config flags persist settings, inspect without secrets, and clear individual preferences", async () => {
  const capture = output();
  const command = createConfigCommand({ ...capture, config });
  await command.action({
    provider: "custom",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    apiKey: "secret-local",
    defaultProvider: "custom",
  });
  config.setKey("openai", "secret-hosted");
  config.setOpenAIOAuthTokens({
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    idToken: "secret-id",
  });
  await command.action({ show: true });
  assert.equal(capture.exitCode(), 0);
  assert.match(capture.text(), /Default provider: custom/);
  assert.match(capture.text(), /model=llama3.2 \(saved\)/);
  assert.match(capture.text(), /Chat Completions/);
  assert.match(capture.text(), /ChatGPT OAuth/);
  assert.doesNotMatch(capture.text(), /secret-/);
  await command.action({
    provider: "custom",
    clearApiKey: true,
    clearModel: true,
    clearDefaultProvider: true,
  });
  assert.equal(config.getKey("custom"), "");
  assert.equal(config.getModel("custom"), "");
  assert.equal(config.getDefaultProvider(), undefined);
  assert.equal(config.getCustomBaseURL(), "http://localhost:11434/v1");
});

for (const options of [
  { defaultProvider: "unknown" },
  { provider: "custom", model: " " },
  { model: "no-provider" },
  { provider: "openai", baseUrl: "http://localhost:1234/v1" },
  { provider: "custom", baseUrl: "bad", model: "local" },
  { provider: "custom", apiKey: "" },
  { provider: "custom", apiKey: "key", clearApiKey: true },
  { provider: "openai", model: "test", clearModel: true },
  { defaultProvider: "custom", clearDefaultProvider: true },
  { provider: "custom", model: "local", clearCustomEndpoint: true },
  { provider: "openai" },
]) {
  test(`config rejects invalid/conflicting preferences without partial writes: ${JSON.stringify(options)}`, async () => {
    config.setModel("custom", "original");
    const capture = output();
    await createConfigCommand({ ...capture, config }).action(options);
    assert.equal(capture.exitCode(), 1, capture.text());
    assert.equal(config.getModel("custom"), "original");
    assert.equal(config.getDefaultProvider(), undefined);
    assert.equal(config.getCustomBaseURL(), "");
    assert.equal(config.getKey("custom"), "");
  });
}

test("Commander config options and root/alias overrides survive global-option merging", async () => {
  const capture = output();
  const commands = [
    createMainCommand(),
    createConfigCommand({ ...capture, config }),
  ];
  const program = createProgram({
    commands,
    metadata: { name: "gsmart", version: "test", description: "test" },
  }).exitOverride();
  await program.parseAsync(
    [
      "config",
      "--provider",
      "custom",
      "--model",
      "local",
      "--base-url",
      "http://localhost:1234/v1",
      "--default-provider",
      "custom",
    ],
    { from: "user" },
  );
  assert.equal(capture.exitCode(), 0, capture.text());
  assert.equal(config.getDefaultProvider(), "custom");
  assert.equal(config.getModel("custom"), "local");
  for (const prefix of [[], ["generate"]]) {
    let received: Record<string, unknown> = {};
    const descriptor = {
      ...createMainCommand(),
      action: (args: Record<string, unknown>) => {
        received = args;
      },
    };
    const app = createProgram({
      commands: [descriptor],
      metadata: { name: "gsmart", version: "test", description: "test" },
    });
    await app.parseAsync(
      [...prefix, "--provider", "custom", "--model", "one-off"],
      { from: "user" },
    );
    assert.equal(received.provider, "custom");
    assert.equal(received.model, "one-off");
  }
});

test("interactive provider and model preferences can be saved and cleared", async () => {
  const capture = output();
  const responses: Record<string, unknown>[] = [
    { action: "provider" },
    { provider: "anthropic" },
    { action: "model" },
    { provider: "anthropic" },
    { model: "custom-anthropic" },
    { action: "provider" },
    { provider: "" },
    { action: "model" },
    { provider: "anthropic" },
    { model: "" },
  ];
  const command = createConfigCommand({
    ...capture,
    config,
    prompt: async () => responses.shift() ?? {},
  });
  await command.action({});
  assert.equal(config.getDefaultProvider(), "anthropic");
  await command.action({});
  assert.equal(config.getModel("anthropic"), "custom-anthropic");
  await command.action({});
  assert.equal(config.getDefaultProvider(), undefined);
  await command.action({});
  assert.equal(config.getModel("anthropic"), "");
  assert.equal(capture.exitCode(), 0);
});

test("config can remove the custom endpoint while retaining unrelated provider defaults", async () => {
  config.setDefaultProvider("anthropic");
  config.setCustomBaseURL("http://localhost:1234/v1");
  config.setModel("custom", "local");
  config.setKey("custom", "key");
  const capture = output();
  await createConfigCommand({ ...capture, config }).action({
    clearCustomEndpoint: true,
  });
  assert.equal(capture.exitCode(), 0);
  assert.equal(config.getCustomBaseURL(), "");
  assert.equal(config.getModel("custom"), "");
  assert.equal(config.getKey("custom"), "");
  assert.equal(config.getDefaultProvider(), "anthropic");
});

for (const entry of ["config", "login"]) {
  test(`${entry} interactive endpoint setup supports blank authentication and cancellation`, async () => {
    config.setKey("custom", "old-key");
    const capture = output();
    const responses = [
      { action: "endpoint", provider: "custom" },
      { baseURL: "http://localhost:1234/v1" },
      { model: "local-model" },
      { key: "" },
    ];
    const deps = {
      ...capture,
      config,
      prompt: async () => responses.shift() ?? {},
    };
    const command =
      entry === "config" ? createConfigCommand(deps) : createLoginCommand(deps);
    await command.action({});
    assert.equal(config.getModel("custom"), "local-model");
    assert.equal(config.getCustomBaseURL(), "http://localhost:1234/v1");
    assert.equal(config.getKey("custom"), "");
    responses.push(
      { action: "endpoint", provider: "custom" },
      { baseURL: "http://localhost:9999/v1" },
      { model: "other" },
    );
    await command.action({});
    assert.equal(
      config.getModel("custom"),
      "local-model",
      "cancelled key prompt must not save any settings",
    );
    assert.equal(config.getCustomBaseURL(), "http://localhost:1234/v1");
  });
}

function mainRun() {
  const capture = output();
  const requests: { provider: Provider; options?: GenerationOptions }[] = [];
  const questions: string[] = [];
  let retrievals = 0;
  const command = createMainCommand({
    ...capture,
    config,
    loadEffectiveConventions: async () => resolveConventions(),
    getActiveProviders: () => providers,
    retrieveFilesToCommit: async () => {
      retrievals++;
      return "diff";
    },
    getGitBranch: async () => "main",
    prompt: async (question) => {
      questions.push(String((question as { name: string }).name));
      return { value: "anthropic", action: "nothing" };
    },
    AIBuilder: class {
      constructor(private provider: Provider) {}
      async generateCommitMessage(
        _branch: string,
        _diff: string,
        options?: GenerationOptions,
      ) {
        requests.push({ provider: this.provider, options });
        return "feat: local";
      }
    },
    commitChanges: async () => assert.fail("dry run must not commit"),
    debugLog: () => {},
    debugTime: () => () => {},
  });
  return {
    ...capture,
    command,
    requests,
    questions,
    retrievals: () => retrievals,
  };
}

test("generation uses saved default without a chooser and explicit provider/model overrides it", async () => {
  config.setKey("openai", "sk-hosted-key");
  config.setKey("anthropic", "sk-ant-hosted-key");
  config.setDefaultProvider("anthropic");
  config.setModel("anthropic", "saved-anthropic");
  config.setModel("openai", "saved-openai");
  const run = mainRun();
  await run.command.action({ dryRun: true });
  await run.command.action({
    dryRun: true,
    yes: true,
    provider: "openai",
    model: "explicit",
  });
  assert.deepEqual(
    run.requests.map((r) => [r.provider, r.options?.model]),
    [
      ["anthropic", "saved-anthropic"],
      ["openai", "explicit"],
    ],
  );
  assert.deepEqual(run.questions, []);
  assert.equal(config.getDefaultProvider(), "anthropic");
  assert.equal(config.getModel("openai"), "saved-openai");
});

test("no saved default preserves interactive selection and --yes fallback", async () => {
  config.setKey("openai", "sk-hosted-key");
  config.setKey("anthropic", "sk-ant-hosted-key");
  const run = mainRun();
  await run.command.action({ dryRun: true });
  await run.command.action({ dryRun: true, yes: true });
  assert.deepEqual(
    run.requests.map((r) => r.provider),
    ["anthropic", "openai"],
  );
  assert.deepEqual(run.questions, ["value"]);
});

test("keyless custom default works without hosted login, including one-off model", async () => {
  config.setDefaultProvider("custom");
  config.setCustomBaseURL("http://localhost:11434/v1");
  const run = mainRun();
  await run.command.action({ dryRun: true, model: "one-off" });
  assert.equal(run.exitCode(), 0, run.text());
  assert.equal(run.requests[0].provider, "custom");
  assert.equal(run.requests[0].options?.model, "one-off");
});

test("unconfigured saved provider and empty model fail before staging with diagnostics", async () => {
  config.setDefaultProvider("custom");
  config.setKey("openai", "sk-hosted-key");
  const run = mainRun();
  await run.command.action({ yes: true });
  assert.equal(run.exitCode(), 1);
  assert.equal(run.retrievals(), 0);
  assert.deepEqual(run.requests, []);
  const invalid = mainRun();
  await invalid.command.action({ provider: "openai", model: "   ", yes: true });
  assert.equal(invalid.exitCode(), 1);
  assert.match(invalid.text(), /non-empty/);
  assert.equal(invalid.retrievals(), 0);
});
