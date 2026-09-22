import "../test-support/setup-env";
import "../test-support/isolated-config";
import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import { join } from "node:path";
import prompts from "prompts";
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

for (const operation of ["chat/completions", "responses"]) {
  test(`operation URLs for ${operation} are rejected with any number of trailing slashes`, async () => {
    for (const suffix of ["", "/", "//", "////"]) {
      assert.throws(
        () => validateBaseURL(`http://localhost:1234/v1/${operation}${suffix}`),
        /Use the API base URL/,
        `must reject ${operation}${suffix}`,
      );
    }

    config.setCustomBaseURL("http://localhost:11434/v1");
    config.setModel("custom", "saved-model");
    config.setKey("custom", "saved-key");
    const capture = output();
    await createConfigCommand({ ...capture, config }).action({
      provider: "custom",
      baseUrl: `http://localhost:1234/v1/${operation}//`,
      model: "replacement-model",
      apiKey: "replacement-key",
      defaultProvider: "custom",
    });
    assert.equal(capture.exitCode(), 1, capture.text());
    assert.match(capture.text(), /Use the API base URL/);
    assert.equal(config.getCustomBaseURL(), "http://localhost:11434/v1");
    assert.equal(config.getModel("custom"), "saved-model");
    assert.equal(config.getKey("custom"), "saved-key");
    assert.equal(config.getDefaultProvider(), undefined);
  });
}

test("valid API base URLs still normalize repeated trailing slashes", () => {
  for (const path of ["/v1", "/responses/v1", "/chat/completions-proxy/v1"]) {
    assert.equal(
      validateBaseURL(` https://localhost:1234${path}//// `),
      `https://localhost:1234${path}`,
    );
  }
});

for (const suffix of ["?", "#", "?#"]) {
  test(`custom base URLs reject bare delimiters ${suffix} without changing saved settings`, async () => {
    const original = "http://localhost:11434/v1";
    const invalid = `${original}${suffix}`;
    config.setCustomBaseURL(original);
    config.setModel("custom", "original-model");
    assert.throws(() => validateBaseURL(invalid), /query|fragment/);
    assert.throws(() => config.setCustomBaseURL(invalid), /query|fragment/);
    assert.equal(config.getCustomBaseURL(), original);

    const capture = output();
    await createConfigCommand({ ...capture, config }).action({
      provider: "custom",
      baseUrl: invalid,
      model: "replacement-model",
      defaultProvider: "custom",
    });
    assert.equal(capture.exitCode(), 1, capture.text());
    assert.match(capture.text(), /query|fragment/);
    assert.equal(config.getCustomBaseURL(), original);
    assert.equal(config.getModel("custom"), "original-model");
    assert.equal(config.getDefaultProvider(), undefined);
  });
}

test("custom base URLs preserve percent-encoded delimiters in the path", () => {
  assert.equal(
    validateBaseURL(" https://localhost/proxy%3Fname%23part/v1/ "),
    "https://localhost/proxy%3Fname%23part/v1",
  );
});

test("configured detection rejects a legacy stored URL with bare delimiters", () => {
  fs.writeFileSync(
    join(process.env.GSMART_CONFIG_DIR!, "config.json"),
    JSON.stringify({
      custom: { baseURL: "http://localhost:1234/v1?#", model: "local" },
    }),
  );
  assert.equal(isProviderConfigured("custom", config), false);
  assert.equal(
    isProviderConfigured("custom", config.getProviderSnapshot()),
    false,
  );
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

test("legacy OAuth tokens remain usable without a key but do not override API-key login", async () => {
  config.setOpenAIOAuthTokens({
    accessToken: "legacy-access",
    refreshToken: "legacy-refresh",
    idToken: "legacy-id",
  });
  config.setOpenAIAuthMode("api-key");
  config.setDefaultProvider("openai");
  assert.equal(isProviderConfigured("openai", config), true);
  const oauth = mainRun();
  await oauth.command.action({ dryRun: true });
  assert.equal(oauth.exitCode(), 0, oauth.text());
  assert.equal(oauth.requests[0].options?.model, "gpt-5-codex");

  config.setKey("openai", "sk-api-key-123456789");
  const apiKey = mainRun();
  await apiKey.command.action({ dryRun: true });
  assert.equal(apiKey.exitCode(), 0, apiKey.text());
  assert.equal(apiKey.requests[0].options?.model, defaultModels.openai);
  assert.equal(config.getOpenAIOAuthTokens()?.accessToken, "legacy-access");
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

test("config show reads the store twice and observes later writes and auth changes", async (t) => {
  const capture = output();
  const command = createConfigCommand({ ...capture, config });
  const configPath = join(process.env.GSMART_CONFIG_DIR!, "config.json");
  const readFileSync = fs.readFileSync;
  let reads = 0;
  t.mock.method(
    fs,
    "readFileSync",
    (...args: Parameters<typeof readFileSync>) => {
      if (String(args[0]) === configPath) reads++;
      return readFileSync(...args);
    },
  );

  await command.action({ show: true });
  assert.equal(capture.exitCode(), 0, capture.text());
  assert.equal(reads, 2, "one prompt read and one provider snapshot read");
  assert.match(capture.text(), /Default provider: automatic selection/);
  assert.match(
    capture.text(),
    /custom: model=not configured \(required\); authentication=none/,
  );

  config.setDefaultProvider("custom");
  config.setPrompt("Fresh instructions");
  config.setModel("custom", "fresh-model");
  config.setCustomBaseURL("http://localhost:1234/v1");
  config.setKey("custom", "secret-custom");
  config.setKey("openai", "secret-hosted");
  config.setOpenAIOAuthTokens({
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    idToken: "secret-id",
  });
  reads = 0;
  await command.action({ show: true });
  assert.equal(reads, 2);
  assert.match(capture.text(), /Default provider: custom/);
  assert.match(capture.text(), /Fresh instructions/);
  assert.match(
    capture.text(),
    /custom: model=fresh-model \(saved\); authentication=API key configured/,
  );
  assert.match(capture.text(), /Endpoint: http:\/\/localhost:1234\/v1/);
  assert.match(
    capture.text(),
    /openai: model=gpt-5-codex \(built-in\); authentication=ChatGPT OAuth/,
  );

  config.setOpenAIAuthMode("api-key");
  reads = 0;
  await command.action({ show: true });
  assert.equal(reads, 2);
  assert.match(
    capture.text(),
    new RegExp(
      `openai: model=${defaultModels.openai} \\(built-in\\); authentication=API key configured`,
    ),
  );
  assert.doesNotMatch(capture.text(), /secret-/);
});

test("config saves combined provider and prompt updates before showing them", async () => {
  const capture = output();
  const command = createConfigCommand({ ...capture, config });
  await command.action({
    defaultProvider: "anthropic",
    addCustomPrompt: "Use Spanish",
    show: true,
  });
  assert.equal(capture.exitCode(), 0, capture.text());
  assert.equal(config.getDefaultProvider(), "anthropic");
  assert.equal(config.getPrompt(), "Use Spanish");
  assert.match(capture.text(), /Use Spanish/);
  assert.match(capture.text(), /Default provider: anthropic/);

  await command.action({ clearDefaultProvider: true, clearCustomPrompt: true });
  assert.equal(config.getDefaultProvider(), undefined);
  assert.equal(config.getPrompt(), "");
});

test("conflicting prompt options fail before writing provider or prompt settings", async () => {
  config.setPrompt("Original instructions");
  const capture = output();
  await createConfigCommand({ ...capture, config }).action({
    defaultProvider: "anthropic",
    addCustomPrompt: "New instructions",
    clearCustomPrompt: true,
  });
  assert.equal(capture.exitCode(), 1);
  assert.equal(config.getDefaultProvider(), undefined);
  assert.equal(config.getPrompt(), "Original instructions");
});

test("invalid provider settings do not partially apply combined prompt changes", async () => {
  config.setPrompt("Original instructions");
  const capture = output();
  await createConfigCommand({ ...capture, config }).action({
    provider: "custom",
    baseUrl: "invalid",
    addCustomPrompt: "New instructions",
  });
  assert.equal(capture.exitCode(), 1);
  assert.equal(config.getPrompt(), "Original instructions");
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

for (const responses of [
  [{}],
  [{ action: "provider" }, {}],
  [{ action: "model" }, {}],
  [{ action: "model" }, { provider: "anthropic" }, {}],
]) {
  test(`canceled config selection preserves preferences: ${JSON.stringify(responses)}`, async () => {
    config.setDefaultProvider("anthropic");
    config.setModel("anthropic", "saved-model");
    const capture = output();
    const remaining = [...responses];
    await createConfigCommand({
      ...capture,
      config,
      prompt: async () => {
        assert.ok(remaining.length, "must stop prompting after cancellation");
        return remaining.shift()!;
      },
    }).action({});
    assert.equal(config.getDefaultProvider(), "anthropic");
    assert.equal(config.getModel("anthropic"), "saved-model");
    assert.equal(remaining.length, 0);
    assert.doesNotMatch(capture.text(), /saved/i);
  });
}

test("invalid config sets the default process exit code and preserves settings", async () => {
  config.setDefaultProvider("anthropic");
  const capture = output();
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = 0;
    await createConfigCommand({
      config,
      spinner: capture.spinner,
      log: capture.log,
      prompt: async () => assert.fail("invalid flags must not open a prompt"),
    }).action({ defaultProvider: "unknown-provider" });
    assert.equal(process.exitCode, 1);
    assert.match(capture.text(), /Unknown provider/);
    assert.equal(config.getDefaultProvider(), "anthropic");
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("interactive prompt clearing reports an empty store without asking for confirmation", async () => {
  const capture = output();
  const questions: string[] = [];
  await createConfigCommand({
    ...capture,
    config,
    prompt: async (question) => {
      assert.ok(!Array.isArray(question));
      questions.push(String(question.name));
      return { action: "clear" };
    },
  }).action({});
  assert.deepEqual(questions, ["action"]);
  assert.match(capture.text(), /No default prompt to clear/);
  assert.equal(config.getPrompt(), "");
});

for (const failure of [
  undefined,
  new Error("Browser authorization failed"),
  "unexpected failure",
]) {
  test(`unsuccessful OpenAI login preserves the current authentication: ${String(failure)}`, async () => {
    const tokens = {
      accessToken: "saved-access",
      refreshToken: "saved-refresh",
      idToken: "saved-id",
    };
    config.setOpenAIOAuthTokens(tokens);
    config.setOpenAIAuthMode("api-key");
    config.setKey("openai", "sk-saved-key-123456");
    const capture = output();
    let logins = 0;
    const questions: string[] = [];
    await createLoginCommand({
      ...capture,
      config,
      prompt: async (question) => {
        assert.ok(!Array.isArray(question));
        questions.push(String(question.name));
        if (question.name === "provider") return { provider: "openai" };
        assert.equal(
          question.name,
          "authMethod",
          "must not fall through to API-key login",
        );
        return failure === undefined ? {} : { authMethod: "oauth" };
      },
      loginWithOpenAIOAuth: async () => {
        logins++;
        throw failure;
      },
    }).action({});
    assert.equal(logins, failure === undefined ? 0 : 1);
    assert.deepEqual(questions, ["provider", "authMethod"]);
    assert.equal(config.getOpenAIAuthMode(), "api-key");
    assert.equal(config.getKey("openai"), "sk-saved-key-123456");
    assert.deepEqual(config.getOpenAIOAuthTokens(), tokens);
    assert.match(
      capture.text(),
      failure === undefined
        ? /No authentication method selected/
        : failure instanceof Error
          ? /Browser authorization failed/
          : /ChatGPT login failed/,
    );
    assert.doesNotMatch(
      capture.text(),
      /saved-access|saved-refresh|sk-saved-key/,
    );
  });
}

for (const [input, expected] of [
  ["\r", ""],
  ["\x1b", "saved-model"],
] as const) {
  test(`real model prompt ${input === "\r" ? "clears on blank Enter" : "preserves on Escape"}`, async (t) => {
    config.setModel("anthropic", "saved-model");
    const capture = output();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    t.after(() => {
      stdin.destroy();
      stdout.destroy();
    });
    const command = createConfigCommand({
      ...capture,
      config,
      prompt: async (question) => {
        assert.ok(!Array.isArray(question));
        if (question.name === "action") return { action: "model" };
        if (question.name === "provider") return { provider: "anthropic" };
        assert.match(
          String(question.message),
          /saved-model/,
          "show the current model without making it the input default",
        );
        const response = prompts({ ...question, stdin, stdout });
        setImmediate(() => stdin.write(input));
        return response;
      },
    });
    await command.action({});
    assert.equal(capture.exitCode(), 0, capture.text());
    assert.equal(config.getModel("anthropic"), expected);
  });
}

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

  for (const cancelAt of ["baseURL", "model", "key"]) {
    test(`${entry} cancels custom setup at ${cancelAt} without changing any saved values`, async () => {
      config.setCustomBaseURL("http://localhost:1234/v1");
      config.setModel("custom", "saved-model");
      config.setKey("custom", "saved-secret");
      const capture = output();
      const questions: string[] = [];
      const deps = {
        ...capture,
        config,
        prompt: async (question: Parameters<typeof prompts>[0]) => {
          assert.ok(!Array.isArray(question));
          const name = String(question.name);
          assert.ok(
            !questions.includes(cancelAt),
            "must stop after cancellation",
          );
          questions.push(name);
          if (name === "action") return { action: "endpoint" };
          if (name === "provider") return { provider: "custom" };
          if (name === cancelAt) return {};
          if (name === "baseURL")
            return { baseURL: "http://localhost:9999/v1" };
          if (name === "model") return { model: "new-model" };
          return assert.fail(`Unexpected prompt: ${name}`);
        },
      };
      const command =
        entry === "config"
          ? createConfigCommand(deps)
          : createLoginCommand(deps);
      await command.action({});
      assert.equal(questions.at(-1), cancelAt);
      assert.equal(config.getCustomBaseURL(), "http://localhost:1234/v1");
      assert.equal(config.getModel("custom"), "saved-model");
      assert.equal(config.getKey("custom"), "saved-secret");
      assert.doesNotMatch(capture.text(), /saved|saved-secret/i);
      if (entry === "login") assert.match(capture.text(), /setup cancelled/i);
    });
  }

  test(`${entry} saves custom password authentication without exposing it`, async () => {
    const capture = output();
    const responses: Record<string, unknown>[] = [
      { action: "endpoint", provider: "custom" },
      { baseURL: " http://localhost:1234/v1/ " },
      { model: " local-model " },
      { key: "  short-secret  " },
    ];
    const deps = {
      ...capture,
      config,
      prompt: async () => {
        assert.ok(responses.length, "unexpected prompt");
        return responses.shift()!;
      },
    };
    await (
      entry === "config" ? createConfigCommand(deps) : createLoginCommand(deps)
    ).action({});
    assert.equal(config.getCustomBaseURL(), "http://localhost:1234/v1");
    assert.equal(config.getModel("custom"), "local-model");
    assert.equal(config.getKey("custom"), "short-secret");
    assert.equal(isProviderConfigured("custom", config), true);
    assert.match(capture.text(), /Custom endpoint saved/);
    assert.doesNotMatch(capture.text(), /short-secret/);
  });

  for (const invalid of ["url", "model", "prompt failure"] as const) {
    test(`${entry} reports custom setup ${invalid} without partially replacing settings`, async () => {
      config.setCustomBaseURL("http://localhost:1234/v1");
      config.setModel("custom", "saved-model");
      config.setKey("custom", "saved-secret");
      const capture = output();
      const deps = {
        ...capture,
        config,
        prompt: async (question: Parameters<typeof prompts>[0]) => {
          assert.ok(!Array.isArray(question));
          if (question.name === "action") return { action: "endpoint" };
          if (question.name === "provider") return { provider: "custom" };
          if (invalid === "prompt failure") throw "Terminal unavailable";
          if (question.name === "baseURL")
            return {
              baseURL:
                invalid === "url" ? "invalid" : "http://localhost:9999/v1",
            };
          if (question.name === "model") return { model: "   " };
          return assert.fail(
            "invalid input must stop setup before the password prompt",
          );
        },
      };
      await (
        entry === "config"
          ? createConfigCommand(deps)
          : createLoginCommand(deps)
      ).action({});
      assert.match(
        capture.text(),
        invalid === "url"
          ? /absolute HTTP or HTTPS/
          : invalid === "model"
            ? /non-empty model ID/
            : /Terminal unavailable/,
      );
      assert.equal(config.getCustomBaseURL(), "http://localhost:1234/v1");
      assert.equal(config.getModel("custom"), "saved-model");
      assert.equal(config.getKey("custom"), "saved-secret");
      assert.doesNotMatch(capture.text(), /Custom endpoint saved|saved-secret/);
      if (entry === "config") assert.equal(capture.exitCode(), 1);
    });
  }
}

function mainRun(overrides: Parameters<typeof createMainCommand>[0] = {}) {
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
    ...overrides,
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

for (const selection of ["explicit", "saved"] as const) {
  test(`${selection} hosted provider without credentials fails before staging rather than using another provider`, async () => {
    config.setKey("anthropic", "sk-ant-configured-key");
    if (selection === "saved") config.setDefaultProvider("openai");
    const run = mainRun();
    await run.command.action({
      yes: true,
      ...(selection === "explicit" ? { provider: "openai" } : {}),
    });
    assert.equal(run.exitCode(), 1);
    assert.match(run.text(), /Provider openai is not configured.*gsmart login/);
    assert.equal(run.retrievals(), 0);
    assert.deepEqual(run.requests, []);
    assert.deepEqual(run.questions, []);
  });
}

test("custom default with a URL but no model fails before staging", async () => {
  config.setDefaultProvider("custom");
  config.setCustomBaseURL("http://localhost:1234/v1");
  const run = mainRun();
  await run.command.action({ yes: true });
  assert.equal(run.exitCode(), 1);
  assert.match(run.text(), /No model configured for custom.*--model/);
  assert.equal(run.retrievals(), 0);
  assert.deepEqual(run.requests, []);
});

test("a saved keyless custom model is selected automatically without prompts", async () => {
  config.setCustomBaseURL("http://localhost:1234/v1");
  config.setModel("custom", "saved-local");
  const run = mainRun();
  await run.command.action({ dryRun: true });
  assert.equal(run.exitCode(), 0, run.text());
  assert.equal(run.requests[0].provider, "custom");
  assert.equal(run.requests[0].options?.model, "saved-local");
  assert.deepEqual(run.questions, []);
});

test("losing the selected provider credentials during file selection never falls back to another provider", async () => {
  config.setKey("openai", "sk-api-key-123456789");
  config.setKey("anthropic", "sk-ant-configured-key");
  const run = mainRun({
    retrieveFilesToCommit: async () => {
      config.clearKey("openai");
      return "diff";
    },
  });
  await run.command.action({ provider: "openai", dryRun: true });
  assert.match(run.text(), /No valid provider/);
  assert.deepEqual(run.requests, []);
  assert.deepEqual(run.questions, []);
});

for (const failure of [
  new Error("Cannot read model preference"),
  "Preference store unavailable",
]) {
  test(`model preference read failure is reported without starting generation: ${String(failure)}`, async (t) => {
    config.setKey("anthropic", "sk-ant-configured-key");
    t.mock.method(config, "getModel", () => {
      throw failure;
    });
    const run = mainRun();
    await run.command.action({ provider: "anthropic", dryRun: true });
    assert.equal(run.exitCode(), 1);
    assert.ok(
      run.text().includes(failure instanceof Error ? failure.message : failure),
    );
    assert.deepEqual(run.requests, []);
    assert.deepEqual(run.questions, []);
  });
}
