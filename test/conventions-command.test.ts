import "../test-support/setup-env";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { createMainCommand } from "../src/commands/main.ts";
import { createConfigCommand } from "../src/commands/config.ts";
import { loadEffectiveConventions } from "../src/utils/repository-config.ts";
import type { GenerationOptions } from "../src/utils/ai.ts";
import { repository } from "../test-support/repository.ts";
import { createProgram } from "../src/program.ts";

function setup(cwd: string, responses: Record<string, unknown>[] = []) {
  const requests: {
    branch: string;
    diff: string;
    options?: GenerationOptions;
  }[] = [];
  const constructedPrompts: string[] = [];
  const historyReads: { cwd: string; limit: number }[] = [];
  const events: string[] = [];
  let retrievals = 0;
  let resolutions = 0;
  let exitCode = 0;
  const snapshots = [
    { branch: "feature/APP-7", diff: "initial diff", fingerprint: "initial" },
    { branch: "feature/APP-7", diff: "updated diff", fingerprint: "updated" },
  ];
  const spinner = {
    start() {
      return this;
    },
    stop() {
      return this;
    },
    fail(text: string) {
      events.push(text);
      return this;
    },
    succeed(text: string) {
      events.push(text);
      return this;
    },
    info(text: string) {
      events.push(text);
      return this;
    },
    warn(text: string) {
      events.push(text);
      return this;
    },
    text: "",
  };
  const command = createMainCommand({
    spinner: (() => spinner) as never,
    config: {
      getDefaultProvider: () => undefined,
      getModel: () => "",
      getKey: () => "private-key",
      getPrompt: () => "User instructions",
      getAllKeys: () => ({ anthropic: "private-key" }),
    } as never,
    loadEffectiveConventions: async (options) => {
      resolutions++;
      return loadEffectiveConventions({ ...options, cwd });
    },
    getRecentCommitSubjects: async (cwd, limit) => {
      historyReads.push({ cwd, limit });
      return ["fix(cli): historical style"];
    },
    retrieveFilesToCommit: async () => {
      retrievals++;
      return "initial diff";
    },
    getGitBranch: async () => "feature/APP-7",
    getStagedSnapshot: async () =>
      snapshots.length > 1 ? snapshots.shift()! : snapshots[0],
    getActiveProviders: () => [
      { title: "Anthropic", value: "anthropic", active: true, description: "" },
    ],
    AIBuilder: class {
      constructor(_provider: string, prompt: string) {
        constructedPrompts.push(prompt);
      }
      async generateCommitMessage(
        branch: string,
        diff: string,
        options?: GenerationOptions,
      ) {
        requests.push({ branch, diff, options });
        return "fix(cli): message";
      }
    },
    prompt: async () => responses.shift() ?? { action: "nothing" },
    log: (text) => events.push(text),
    debugLog: () => {},
    debugTime: () => () => {},
    setExitCode: (code) => {
      exitCode = code;
    },
    commitChanges: async () => assert.fail("This test must not commit"),
  });
  return {
    command,
    requests,
    constructedPrompts,
    historyReads,
    retrievals: () => retrievals,
    resolutions: () => resolutions,
    exitCode: () => exitCode,
    output: () => stripVTControlCharacters(events.join("\n")),
  };
}

test("context flags preserve repository opt-in unless explicitly overridden", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({
      context: { summarize: true, budgetTokens: 12000, exclude: ["dist/**"] },
    }),
  );
  for (const [args, expected] of [
    [[], { summarize: true, budgetTokens: 12000, exclude: ["dist/**"] }],
    [
      [
        "--no-summarize",
        "--context-budget",
        "16000",
        "--context-exclude",
        "vendor/**",
      ],
      { summarize: false, budgetTokens: 16000, exclude: ["vendor/**"] },
    ],
  ] as const) {
    const run = setup(root);
    const program = createProgram({
      commands: [run.command],
      metadata: { name: "gsmart", version: "test", description: "test" },
    });
    await program.parseAsync(["--dry-run", ...args], { from: "user" });
    const context = run.requests[0].options?.conventions?.context;
    assert.equal(context?.summarize, expected.summarize);
    assert.equal(context?.budgetTokens, expected.budgetTokens);
    assert.deepEqual(context?.exclude, expected.exclude);
  }
});

test("invalid context budget relationships fail before selecting or staging files", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({ context: { budgetTokens: 2048, outputTokens: 2048 } }),
  );
  const run = setup(root);
  await run.command.action({ yes: true });
  assert.equal(run.retrievals(), 0);
  assert.equal(run.exitCode(), 1);
  assert.match(run.output(), /leave room for input/);
});

for (const context of [
  { outputTokens: 32768 },
  { budgetTokens: null, outputTokens: 32768 },
  { outputTokens: 32256 },
]) {
  test(`impossible implicit output budgets fail before auto-staging: ${JSON.stringify(context)}`, async (t) => {
    const root = repository(t);
    writeFileSync(join(root, ".gsmartrc.json"), JSON.stringify({ context }));
    const run = setup(root);
    await run.command.action({ yes: true });
    assert.equal(
      run.retrievals(),
      0,
      "invalid settings must stop before staging/file selection",
    );
    assert.deepEqual(run.requests, []);
    assert.equal(run.exitCode(), 1);
    assert.match(run.output(), /leave room for input/);
  });
}

test("implicit validation allows output reserves supported by known models without fixing a model budget early", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({ context: { outputTokens: 16000 } }),
  );
  const run = setup(root);
  await run.command.action({ dryRun: true });
  assert.equal(run.exitCode(), 0);
  assert.equal(run.retrievals(), 1);
  assert.equal(
    run.requests[0].options?.conventions?.context.budgetTokens,
    null,
  );
  assert.equal(
    run.requests[0].options?.conventions?.context.outputTokens,
    16000,
  );
});

test("an explicit larger budget permits the maximum output reserve", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({ context: { budgetTokens: 65536, outputTokens: 32768 } }),
  );
  const run = setup(root);
  await run.command.action({ dryRun: true });
  assert.equal(run.exitCode(), 0);
  assert.equal(run.retrievals(), 1);
  assert.equal(
    run.requests[0].options?.conventions?.context.budgetTokens,
    65536,
  );
});

test("generation selects repository instructions above user prompt and propagates CLI language", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({
      instructions: "Repository instructions",
      language: "es",
      types: ["fix"],
    }),
  );
  const run = setup(root);
  await run.command.action({ dryRun: true, language: "pt-BR" });
  assert.equal(run.exitCode(), 0);
  assert.deepEqual(run.constructedPrompts, ["Repository instructions"]);
  assert.deepEqual(run.requests[0].options?.conventions?.types, ["fix"]);
  assert.equal(run.requests[0].options?.conventions?.language, "pt-BR");
  assert.deepEqual(run.historyReads, []);
});

test("explicit CLI prompt and history opt-out override their repository fields", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({
      instructions: "Repo",
      scopes: ["cli"],
      history: { enabled: true, limit: 4 },
    }),
  );
  const run = setup(root);
  await run.command.action({
    yes: true,
    dryRun: true,
    prompt: "CLI instructions",
    historyExamples: "0",
  });
  assert.deepEqual(run.constructedPrompts, ["CLI instructions"]);
  assert.deepEqual(run.requests[0].options?.conventions?.scopes, ["cli"]);
  assert.deepEqual(run.historyReads, []);
  assert.deepEqual(run.requests[0].options?.historyExamples, []);
});

test("initial, refined and refreshed candidates share one resolved configuration and history read", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({
      instructions: "Team style",
      language: "es",
      body: { presence: "required" },
      breakingChanges: { requireFooter: true },
    }),
  );
  const run = setup(root, [
    { action: "regenerate" },
    { feedback: "shorter" },
    { action: "commit" },
    { refresh: true },
    { action: "nothing" },
  ]);
  await run.command.action({ historyExamples: "3", model: "session-model" });
  assert.equal(run.resolutions(), 1);
  assert.deepEqual(run.historyReads, [{ cwd: root, limit: 3 }]);
  assert.equal(run.requests.length, 3);
  assert.equal(run.requests[1].options?.refinement?.feedback, "shorter");
  assert.equal(run.requests[2].diff, "updated diff");
  for (const request of run.requests) {
    assert.equal(request.options?.model, "session-model");
    assert.equal(
      request.options?.conventions,
      run.requests[0].options?.conventions,
    );
    assert.equal(request.options?.conventions?.body.presence, "required");
    assert.equal(
      request.options?.conventions?.breakingChanges.requireFooter,
      true,
    );
    assert.deepEqual(request.options?.historyExamples, [
      "fix(cli): historical style",
    ]);
  }
});

test("invalid repository settings fail before staging, prompts or generation", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    '{"openai":{"key":"private-key"}}',
  );
  const run = setup(root);
  await run.command.action({ yes: true });
  assert.equal(run.exitCode(), 1);
  assert.equal(run.retrievals(), 0);
  assert.deepEqual(run.requests, []);
  assert.match(run.output(), /\.gsmartrc.json.*\/openai/);
  assert.doesNotMatch(run.output(), /private-key/);
});

for (const options of [
  { language: "bad language" },
  { historyExamples: "30" },
]) {
  test(`invalid CLI conventions fail before repository lookup or staging: ${JSON.stringify(options)}`, async (t) => {
    const run = setup(repository(t));
    await run.command.action({ ...options, yes: true });
    assert.equal(run.exitCode(), 1);
    assert.equal(run.resolutions(), 0);
    assert.equal(run.retrievals(), 0);
    assert.deepEqual(run.requests, []);
  });
}

test("show-effective reports resolved settings, sources and diagnostics without credentials", async (t) => {
  const root = repository(t);
  writeFileSync(
    join(root, ".gsmartrc.json"),
    '{"language":"es","instructions":"Team style"}',
  );
  writeFileSync(
    join(root, ".commitlintrc.json"),
    JSON.stringify({
      rules: {
        "subject-case": [2, "always", "lower-case"],
        "header-max-length": [1, "always", 72],
      },
    }),
  );
  const output: string[] = [];
  const command = createConfigCommand({
    promptConfig: {
      getPrompt: () => "User style",
      setPrompt: () => assert.fail("Must not save"),
      clearPrompt: () => assert.fail("Must not clear"),
    },
    loadEffectiveConventions: (options) =>
      loadEffectiveConventions({ ...options, cwd: root }),
    log: (text) => output.push(text),
  });
  await command.action({
    showEffective: true,
    language: "pt",
    prompt: "CLI style",
    contextBudget: "16384",
    contextExclude: ["vendor/**"],
    summarize: false,
  });
  const effective = JSON.parse(output[0]);
  assert.equal(effective.conventions.instructions, "CLI style");
  assert.equal(effective.conventions.language, "pt");
  assert.equal(effective.conventions.headerMaxLength, 72);
  assert.equal(effective.sources.language, "CLI");
  assert.equal(effective.conventions.context.budgetTokens, 16384);
  assert.deepEqual(effective.conventions.context.exclude, ["vendor/**"]);
  assert.equal(effective.conventions.context.summarize, false);
  assert.equal(effective.sources["context.budgetTokens"], "CLI");
  assert.equal(effective.ruleMetadata.headerMaxLength.severity, 1);
  assert.equal(effective.diagnostics.length, 1);
  assert.doesNotMatch(output[0], /apiKey|accessToken|refreshToken|private-key/);
});
