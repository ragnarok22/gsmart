import "../test-support/setup-env";

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  parseFlag,
} from "../src/commands/completions";
import MainCommand from "../src/commands/main";
import LoginCommand from "../src/commands/login";
import ResetCommand from "../src/commands/reset";
import CompletionsCommand from "../src/commands/completions";
import { getActiveProviders } from "../src/utils/providers";

// Derive test data from actual definitions — single source of truth
const allCommands = [
  MainCommand,
  LoginCommand,
  ResetCommand,
  CompletionsCommand,
];
const providerValues = getActiveProviders().map((p) => p.value);
const flagValues = { provider: providerValues };

const COMMANDS = allCommands.map((c) => c.name);
const PROVIDERS = providerValues;

const bashFlags = (cmd: typeof MainCommand) =>
  (cmd.options || []).flatMap((opt) => {
    const f = parseFlag(opt);
    return [f.short ? `-${f.short}` : "", f.long ? `--${f.long}` : ""].filter(
      Boolean,
    );
  });

const fishFlags = (cmd: typeof MainCommand) =>
  (cmd.options || []).flatMap((opt) => {
    const f = parseFlag(opt);
    return [
      f.short ? `-s ${f.short}` : "",
      f.long ? `-l ${f.long}` : "",
    ].filter(Boolean);
  });

describe("bash completion", () => {
  const generate = () => generateBashCompletion(allCommands, flagValues);

  it("includes shell-specific marker", () => {
    assert.ok(generate().includes("complete -F _gsmart_completions gsmart"));
  });

  it("includes all commands", () => {
    const script = generate();
    for (const cmd of COMMANDS) {
      assert.ok(script.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("includes all provider values", () => {
    const script = generate();
    for (const provider of PROVIDERS) {
      assert.ok(script.includes(provider), `Missing provider: ${provider}`);
    }
  });

  it("includes generate flags", () => {
    const script = generate();
    for (const flag of bashFlags(MainCommand)) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });

  it("includes reset flags", () => {
    const script = generate();
    for (const flag of bashFlags(ResetCommand)) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });
});

describe("zsh completion", () => {
  const generate = () => generateZshCompletion(allCommands, flagValues);

  it("includes shell-specific marker", () => {
    assert.ok(generate().includes("#compdef gsmart"));
  });

  it("includes all commands", () => {
    const script = generate();
    for (const cmd of COMMANDS) {
      assert.ok(script.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("includes all provider values", () => {
    const script = generate();
    for (const provider of PROVIDERS) {
      assert.ok(script.includes(provider), `Missing provider: ${provider}`);
    }
  });

  it("includes generate flags", () => {
    const script = generate();
    for (const flag of bashFlags(MainCommand)) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });

  it("includes reset flags", () => {
    const script = generate();
    for (const flag of bashFlags(ResetCommand)) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });
});

describe("fish completion", () => {
  const generate = () => generateFishCompletion(allCommands, flagValues);

  it("includes shell-specific marker", () => {
    assert.ok(generate().includes("complete -c gsmart"));
  });

  it("includes all commands", () => {
    const script = generate();
    for (const cmd of COMMANDS) {
      assert.ok(script.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("includes all provider values", () => {
    const script = generate();
    for (const provider of PROVIDERS) {
      assert.ok(script.includes(provider), `Missing provider: ${provider}`);
    }
  });

  it("includes generate flags", () => {
    const script = generate();
    for (const flag of fishFlags(MainCommand)) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });

  it("includes reset flags", () => {
    const script = generate();
    for (const flag of fishFlags(ResetCommand)) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });
});

describe("parseFlag", () => {
  it("parses short and long flags", () => {
    const result = parseFlag({
      flags: "-p, --prompt <prompt>",
      description: "test",
    });
    assert.strictEqual(result.short, "p");
    assert.strictEqual(result.long, "prompt");
    assert.strictEqual(result.takesValue, true);
  });

  it("parses flags without value", () => {
    const result = parseFlag({ flags: "-f, --force", description: "test" });
    assert.strictEqual(result.short, "f");
    assert.strictEqual(result.long, "force");
    assert.strictEqual(result.takesValue, false);
  });
});
