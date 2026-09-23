import assert from "node:assert/strict";
import test from "node:test";
import {
  parseConventions,
  resolveConventions,
  conventionsFromOptions,
} from "../src/utils/conventions.ts";
import { adaptCommitlintRules } from "../src/utils/commitlint-config.ts";
import { buildCommitPrompt } from "../src/utils/commit-prompt.ts";

test("conventions merge by leaf, replace arrays and preserve explicit false, null and empty text", () => {
  const imported = adaptCommitlintRules(
    {
      "type-enum": [2, "always", ["imported"]],
      "header-max-length": [1, "always", 72],
      "body-empty": [2, "never"],
    },
    "commitlint",
  );
  const effective = resolveConventions([
    {
      source: "user",
      settings: {
        instructions: "user prompt",
        language: "es",
        body: { maxLineLength: 80 },
        history: { enabled: true, limit: 10 },
      },
    },
    ...imported.layers,
    {
      source: "repository",
      settings: {
        instructions: "repository prompt",
        types: ["fix"],
        headerMaxLength: null,
        body: { instructions: "Explain why" },
        history: { enabled: false },
      },
    },
    { source: "CLI", settings: { language: "pt-br", instructions: "" } },
  ]);
  assert.deepEqual(effective.conventions.types, ["fix"]);
  assert.equal(effective.conventions.language, "pt-BR");
  assert.equal(effective.conventions.instructions, "");
  assert.equal(effective.conventions.headerMaxLength, null);
  assert.deepEqual(effective.conventions.body, {
    presence: "required",
    leadingBlank: true,
    maxLineLength: 80,
    instructions: "Explain why",
  });
  assert.deepEqual(effective.conventions.history, {
    enabled: false,
    limit: 10,
  });
  assert.equal(effective.sources["body.presence"], "commitlint");
  assert.equal(effective.sources["body.maxLineLength"], "user");
  assert.equal(effective.sources.language, "CLI");
  assert.equal(effective.sources.scope, "built-in");
  assert.deepEqual(effective.ruleMetadata, {
    "body.presence": { name: "body-empty", severity: 2 },
  });
});

test("defaults are independent and leave history disabled and lengths unrestricted", () => {
  const first = resolveConventions();
  assert.equal(first.conventions.history.enabled, false);
  assert.equal(first.conventions.headerMaxLength, null);
  assert.equal(first.conventions.subjectMaxLength, null);
  assert.equal(first.conventions.tickets.prefixes, null);
  first.conventions.types!.push("mutated");
  first.conventions.history.enabled = true;
  assert.equal(
    resolveConventions().conventions.types!.includes("mutated"),
    false,
  );
  assert.equal(resolveConventions().conventions.history.enabled, false);
});

test("implicit context budgets reject output reserves that exhaust every automatic budget", () => {
  for (const context of [
    { outputTokens: 32_768 },
    { budgetTokens: null, outputTokens: 32_768 },
    { outputTokens: 32_256 },
    { budgetTokens: null, outputTokens: 32_256 },
  ]) {
    assert.throws(
      () => resolveConventions([{ source: "repo", settings: { context } }]),
      /leave room for input/,
    );
  }
});

test("implicit context validation preserves model-dependent budgets and source metadata", () => {
  for (const outputTokens of [16_000, 32_255]) {
    const inherited = resolveConventions([
      { source: "repo", settings: { context: { outputTokens } } },
    ]);
    assert.equal(inherited.conventions.context.budgetTokens, null);
    assert.equal(inherited.conventions.context.outputTokens, outputTokens);
    assert.equal(inherited.sources["context.budgetTokens"], "built-in");
    assert.equal(inherited.sources["context.outputTokens"], "repo");

    const reset = resolveConventions([
      { source: "user", settings: { context: { budgetTokens: 8192 } } },
      {
        source: "repo",
        settings: { context: { budgetTokens: null, outputTokens } },
      },
    ]);
    assert.equal(reset.conventions.context.budgetTokens, null);
    assert.equal(reset.conventions.context.outputTokens, outputTokens);
    assert.equal(reset.sources["context.budgetTokens"], "repo");
    assert.equal(reset.sources["context.outputTokens"], "repo");
  }
});

test("a higher-priority explicit budget can accommodate the maximum output reserve", () => {
  const effective = resolveConventions([
    { source: "repo", settings: { context: { outputTokens: 32_768 } } },
    { source: "CLI", settings: { context: { budgetTokens: 65_536 } } },
  ]);
  assert.equal(effective.conventions.context.budgetTokens, 65_536);
  assert.equal(effective.conventions.context.outputTokens, 32_768);
  assert.equal(effective.sources["context.budgetTokens"], "CLI");
  assert.equal(effective.sources["context.outputTokens"], "repo");
});

for (const [name, value, field] of [
  ["array root", [], "/"],
  ["null root", null, "/"],
  ["unknown property", { typo: true }, "/typo"],
  ["credentials", { openai: { key: "secret" } }, "/openai"],
  ["nested typo", { history: { enable: true } }, "/history/enable"],
  ["string length", { headerMaxLength: "72" }, "/headerMaxLength"],
  ["zero length", { subjectMaxLength: 0 }, "/subjectMaxLength"],
  ["negative length", { headerMaxLength: -1 }, "/headerMaxLength"],
  ["fractional length", { headerMaxLength: 1.5 }, "/headerMaxLength"],
  ["empty types", { types: [] }, "/types"],
  ["duplicate scopes", { scopes: ["cli", "cli"] }, "/scopes"],
  ["invalid type token", { types: ["feat: bad"] }, "/types/0"],
  ["invalid language", { language: "Portuguese Brazil" }, "/language"],
  ["empty language", { language: "" }, "/language"],
  ["too much history", { history: { limit: 21 } }, "/history/limit"],
  ["zero history limit", { history: { limit: 0 } }, "/history/limit"],
  [
    "bad footer token",
    { tickets: { footerToken: "Refs:" } },
    "/tickets/footerToken",
  ],
  ["empty prefix", { tickets: { prefixes: [""] } }, "/tickets/prefixes/0"],
  ["long instructions", { instructions: "x".repeat(10001) }, "/instructions"],
] as const) {
  test(`schema rejects ${name} with an actionable field and source`, () => {
    assert.throws(
      () => parseConventions(value, "/project/.gsmartrc.json"),
      (error: Error) => {
        assert.ok(error.message.includes("/project/.gsmartrc.json"));
        assert.ok(error.message.includes(field));
        assert.ok(error.message.includes("schemas/gsmartrc.schema.json"));
        assert.ok(!error.message.includes("secret"));
        return true;
      },
    );
  });
}

test("schema metadata does not enter generation settings", () => {
  assert.deepEqual(
    parseConventions({ $schema: "schema.json", language: "es" }, "repo"),
    { language: "es" },
  );
});

test("conflicting body and required ticket placement reports both sources", () => {
  assert.throws(
    () =>
      resolveConventions([
        { source: "user", settings: { body: { presence: "forbidden" } } },
        {
          source: "repo",
          settings: { tickets: { required: true, placement: "body" } },
        },
      ]),
    /body.presence \(user\).*tickets.placement \(repo\).*footer/,
  );
});

test("CLI parsing preserves absent defaults and an explicit history opt-out", () => {
  assert.deepEqual(conventionsFromOptions({ prompt: "" }), {});
  assert.deepEqual(
    conventionsFromOptions({
      prompt: "CLI",
      language: "es",
      historyExamples: "0",
    }),
    { instructions: "CLI", language: "es", history: { enabled: false } },
  );
  assert.deepEqual(conventionsFromOptions({ historyExamples: "20" }), {
    history: { enabled: true, limit: 20 },
  });
  for (const value of [
    "",
    "-1",
    "21",
    "1.2",
    "1e1",
    "Infinity",
    " 2",
    "02",
    "abc",
  ]) {
    assert.throws(
      () => conventionsFromOptions({ historyExamples: value }),
      /--history-examples.*0 to 20/,
    );
  }
});

test("prompt propagates all configured conventions without hard-coded conflicting examples", () => {
  const { conventions } = resolveConventions([
    {
      source: "repo",
      settings: {
        types: ["improve"],
        scopes: ["engine"],
        scope: "required",
        headerMaxLength: 72,
        subjectMaxLength: 50,
        language: "es",
        tickets: {
          prefixes: ["APP-"],
          required: true,
          placement: "footer",
          footerToken: "Closes",
        },
        body: {
          presence: "required",
          maxLineLength: 80,
          instructions: "Explain the reason",
        },
        breakingChanges: {
          requireFooter: true,
          instructions: "Include migration steps",
        },
        history: { enabled: true },
      },
    },
  ]);
  const [system, prompt] = buildCommitPrompt(
    "feature/APP-12",
    "+ changes",
    conventions,
    ["improve(engine): old subject"],
  );
  for (const text of [
    "Allowed types: improve",
    "Allowed scopes: engine",
    "Scope is required",
    "at most 72",
    "at most 50",
    "language es",
    "prefixes APP-",
    "Closes:",
    "body is required",
    "at most 80",
    "Explain the reason",
    "always include a BREAKING CHANGE:",
    "Include migration steps",
  ]) {
    assert.ok(system.includes(text), text);
  }
  assert.ok(prompt.includes("feature/APP-12"));
  assert.ok(prompt.includes("+ changes"));
  assert.ok(prompt.includes('"improve(engine): old subject"'));
  assert.doesNotMatch(
    system + prompt,
    /feat\(auth\)|Allowed types: feat|Scope is optional|A multiline body is allowed/,
  );
});

test("disabled history and forbidden bodies/scopes do not add conflicting guidance", () => {
  const { conventions } = resolveConventions([
    {
      source: "repo",
      settings: {
        types: null,
        scopes: ["engine"],
        scope: "forbidden",
        body: {
          presence: "forbidden",
          instructions: "Never included",
          maxLineLength: 80,
        },
        footer: { leadingBlank: false },
      },
    },
  ]);
  const [system, prompt] = buildCommitPrompt("main", "diff", conventions, [
    "secret historical subject",
  ]);
  assert.match(system, /Scope is forbidden/);
  assert.match(system, /body is forbidden/);
  assert.match(system, /do not put a blank line/);
  assert.doesNotMatch(
    system,
    /Allowed types:|Allowed scopes:|Never included|at most 80/,
  );
  assert.doesNotMatch(prompt, /secret historical subject/);
});
