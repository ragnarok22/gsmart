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

  it("dispatches subcommands using $line[1]", () => {
    const script = generate();
    assert.ok(script.includes("case $line[1] in"));
    assert.ok(!script.includes("case $words[1] in"));
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

  it("parses long-only flag", () => {
    const result = parseFlag({ flags: "--verbose", description: "test" });
    assert.strictEqual(result.short, undefined);
    assert.strictEqual(result.long, "verbose");
  });

  it("parses short-only flag", () => {
    const result = parseFlag({ flags: "-v", description: "test" });
    assert.strictEqual(result.short, "v");
    assert.strictEqual(result.long, undefined);
  });
});

describe("CompletionsCommand action", () => {
  it("writes bash completion to stdout", (t) => {
    const chunks: string[] = [];
    t.mock.method(process.stdout, "write", (chunk: string) => {
      chunks.push(chunk);
      return true;
    });

    CompletionsCommand.action({ shell: "bash" });
    assert.ok(
      chunks.join("").includes("complete -F _gsmart_completions gsmart"),
    );
  });

  it("writes zsh completion to stdout", (t) => {
    const chunks: string[] = [];
    t.mock.method(process.stdout, "write", (chunk: string) => {
      chunks.push(chunk);
      return true;
    });

    CompletionsCommand.action({ shell: "zsh" });
    assert.ok(chunks.join("").includes("#compdef gsmart"));
  });

  it("writes fish completion to stdout", (t) => {
    const chunks: string[] = [];
    t.mock.method(process.stdout, "write", (chunk: string) => {
      chunks.push(chunk);
      return true;
    });

    CompletionsCommand.action({ shell: "fish" });
    assert.ok(chunks.join("").includes("complete -c gsmart -f"));
  });
});

describe("generators handle edge-case commands", () => {
  it("skips commands with no options or arguments in fish", () => {
    const cmds = [{ name: "bare", description: "No opts", action: () => {} }];
    const script = generateFishCompletion(cmds, {});
    assert.ok(!script.includes("__fish_seen_subcommand_from bare"));
    assert.ok(script.includes("__fish_use_subcommand"));
  });

  it("skips commands with no options or arguments in zsh args", () => {
    const cmds = [{ name: "bare", description: "No opts", action: () => {} }];
    const script = generateZshCompletion(cmds, {});
    assert.ok(script.includes("'bare:No opts'"));
    assert.ok(!script.includes("bare)"));
  });

  it("handles flag with only long name", () => {
    const cmds = [
      {
        name: "test",
        description: "Test",
        options: [{ flags: "--verbose", description: "Verbose" }],
        action: () => {},
      },
    ];
    const bash = generateBashCompletion(cmds, {});
    assert.ok(bash.includes("--verbose"));

    const fish = generateFishCompletion(cmds, {});
    const testLine = fish
      .split("\n")
      .find((l) => l.includes("__fish_seen_subcommand_from test"));
    assert.ok(testLine);
    assert.ok(testLine.includes("-l verbose"));
    assert.ok(!testLine.includes("-s "));
  });

  it("handles flag with value but no flagValues entry", () => {
    const cmds = [
      {
        name: "test",
        description: "Test",
        options: [{ flags: "-o, --output <path>", description: "Output" }],
        action: () => {},
      },
    ];
    const fish = generateFishCompletion(cmds, {});
    assert.ok(fish.includes("-r"));
    assert.ok(!fish.includes("-a '"));

    const zsh = generateZshCompletion(cmds, {});
    assert.ok(zsh.includes(":output:"));
  });
});
