import "../test-support/setup-env";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { it } from "node:test";
import { CommanderError } from "commander";
import type { ICommand } from "../src/definitions.ts";
import commands from "../src/gsmart.ts";
import { createProgram, type ProgramOptions } from "../src/program.ts";

const metadata = {
  name: "gsmart",
  version: "1.2.3",
  description: "Generate smart commit messages",
};

type Action = (
  name: string,
  options: Record<string, unknown>,
) => void | Promise<void>;

function setup(
  callbacks: Pick<
    ProgramOptions,
    "beforeAction" | "afterAction" | "onDebug"
  > & {
    action?: Action;
  } = {},
) {
  const calls: { name: string; options: Record<string, unknown> }[] = [];
  const events: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({
    metadata,
    commands: commands.map((command) => ({
      ...command,
      action: async (options) => {
        calls.push({ name: command.name, options });
        events.push(`action:${command.name}`);
        await callbacks.action?.(command.name, options);
      },
    })),
    onDebug: async () => {
      events.push("debug");
      await callbacks.onDebug?.();
    },
    beforeAction: async (command, options) => {
      events.push(`before:${command.name}`);
      await callbacks.beforeAction?.(command, options);
    },
    afterAction: async (command, options) => {
      events.push(`after:${command.name}`);
      await callbacks.afterAction?.(command, options);
    },
  });

  // Commander copies these settings when children are created, so configure
  // every existing command. The implicit help command inherits them later.
  for (const command of [program, ...program.commands]) {
    command.exitOverride().configureOutput({
      writeOut: (text) => stdout.push(text),
      writeErr: (text) => stderr.push(text),
      getOutHelpWidth: () => 100,
    });
  }

  return {
    program,
    calls,
    events,
    stdout,
    stderr,
    parse: (args: string[]) => program.parseAsync(args, { from: "user" }),
  };
}

const defaults = {
  debug: false,
  prompt: "",
  provider: "",
  yes: false,
  dryRun: false,
};

for (const args of [
  ["--language", "es", "--history-examples", "0"],
  ["generate", "--language=pt-BR", "--history-examples=5"],
  ["config", "--show-effective", "--language", "es"],
]) {
  it(`parses convention options without implicit overrides: ${args.join(" ")}`, async () => {
    const app = setup();
    await app.parse(args);
    const options = app.calls[0].options;
    assert.equal(
      options.language,
      args.includes("--language=pt-BR") ? "pt-BR" : "es",
    );
    if (args.includes("--history-examples"))
      assert.equal(options.historyExamples, "0");
    if (args.includes("--history-examples=5"))
      assert.equal(options.historyExamples, "5");
    if (args.includes("--show-effective"))
      assert.equal(options.showEffective, true);
  });
}

for (const args of [[], ["generate"]]) {
  it(`runs generation with defaults for ${JSON.stringify(args)}`, async () => {
    const app = setup();
    await app.parse(args);
    assert.deepEqual(app.calls, [{ name: "generate", options: defaults }]);
    assert.deepEqual(app.events, [
      "before:generate",
      "action:generate",
      "after:generate",
    ]);
  });
}

const flagForms = [
  [
    "--provider",
    "openai",
    "--prompt",
    "use short messages",
    "--yes",
    "--dry-run",
  ],
  ["-P", "openai", "-p", "use short messages", "-y", "-d"],
  ["--provider=openai", "--prompt=use short messages", "--yes", "--dry-run"],
  ["-Popenai", "-puse short messages", "-yd"],
];

for (const flags of flagForms) {
  const variants = [
    flags,
    ["generate", ...flags],
    [...flags, "generate"],
    [...flags.slice(0, -1), "generate", flags.at(-1)!],
  ];
  for (const args of variants) {
    it(`preserves generation flags in ${args.join(" ")}`, async () => {
      const app = setup();
      await app.parse(args);
      assert.deepEqual(app.calls, [
        {
          name: "generate",
          options: {
            ...defaults,
            provider: "openai",
            prompt: "use short messages",
            yes: true,
            dryRun: true,
          },
        },
      ]);
    });
  }
}

it("uses the last generation option across both sides of the alias", async () => {
  const app = setup();
  await app.parse([
    "--provider=anthropic",
    "--prompt=first",
    "--yes",
    "generate",
    "-P",
    "openai",
    "-p",
    "last",
    "--dry-run",
  ]);
  assert.deepEqual(app.calls, [
    {
      name: "generate",
      options: {
        ...defaults,
        provider: "openai",
        prompt: "last",
        yes: true,
        dryRun: true,
      },
    },
  ]);
});

it("preserves a required prompt value that looks like an option", async () => {
  const app = setup();
  await app.parse(["--prompt", "--yes"]);
  assert.deepEqual(app.calls, [
    { name: "generate", options: { ...defaults, prompt: "--yes" } },
  ]);
});

for (const name of [
  "generate",
  "login",
  "config",
  "reset",
  "completions",
  "help",
]) {
  for (const prefix of [[], ["generate"]]) {
    it(`treats prompt ${name} as a value with prefix ${JSON.stringify(prefix)}`, async () => {
      const app = setup();
      await app.parse([...prefix, "--prompt", name]);
      assert.deepEqual(app.calls, [
        { name: "generate", options: { ...defaults, prompt: name } },
      ]);
      assert.deepEqual(app.events, [
        "before:generate",
        "action:generate",
        "after:generate",
      ]);
    });
  }
}

const subcommands = [
  { args: ["login"], name: "login", options: {} },
  { args: ["config", "-s"], name: "config", options: { show: true } },
  {
    args: ["config", "--add-custom-prompt", "completions"],
    name: "config",
    options: { addCustomPrompt: "completions" },
  },
  {
    args: ["config", "--clear-custom-prompt"],
    name: "config",
    options: { clearCustomPrompt: true },
  },
  { args: ["reset", "--force"], name: "reset", options: { force: true } },
  ...["bash", "zsh", "fish"].map((shell) => ({
    args: ["completions", shell],
    name: "completions",
    options: { shell },
  })),
];

for (const { args, name, options } of subcommands) {
  it(`selects only the target action for ${args.join(" ")}`, async () => {
    const app = setup();
    await app.parse(args);
    assert.deepEqual(app.calls, [
      { name, options: { ...defaults, ...options } },
    ]);
    assert.deepEqual(
      app.events,
      name === "completions"
        ? ["action:completions"]
        : [`before:${name}`, `action:${name}`, `after:${name}`],
    );
  });
}

for (const args of [
  ["--prompt", "completions", "config", "--show"],
  ["config", "--prompt", "completions", "--show"],
]) {
  it(`uses parsed command selection for ${args.join(" ")}`, async () => {
    const app = setup();
    await app.parse(args);
    assert.deepEqual(app.calls, [
      {
        name: "config",
        options: { ...defaults, prompt: "completions", show: true },
      },
    ]);
    assert.deepEqual(app.events, [
      "before:config",
      "action:config",
      "after:config",
    ]);
  });
}

for (const args of [
  ["-D"],
  ["--debug", "generate"],
  ["generate", "-D"],
  ["--debug", "login"],
  ["login", "-D"],
]) {
  it(`enables debug before the selected action for ${args.join(" ")}`, async () => {
    const app = setup();
    await app.parse(args);
    const name = args.includes("login") ? "login" : "generate";
    assert.deepEqual(app.calls, [
      { name, options: { ...defaults, debug: true } },
    ]);
    assert.deepEqual(app.events, [
      "debug",
      `before:${name}`,
      `action:${name}`,
      `after:${name}`,
    ]);
  });
}

it("honors explicit debug on silent commands without human lifecycle output", async () => {
  const app = setup();
  await app.parse(["completions", "bash", "--debug"]);
  assert.deepEqual(app.events, ["debug", "action:completions"]);
});

const invalidArgs = [
  { args: ["unknown"], code: "commander.excessArguments" },
  { args: ["generate", "unexpected"], code: "commander.excessArguments" },
  { args: ["login", "unexpected"], code: "commander.excessArguments" },
  { args: ["--unknown"], code: "commander.unknownOption" },
  { args: ["generate", "--unknown"], code: "commander.unknownOption" },
  { args: ["--provider"], code: "commander.optionMissingArgument" },
  { args: ["generate", "--prompt"], code: "commander.optionMissingArgument" },
  {
    args: ["config", "--add-custom-prompt"],
    code: "commander.optionMissingArgument",
  },
  { args: ["completions"], code: "commander.missingArgument" },
  { args: ["completions", "powershell"], code: "commander.invalidArgument" },
  { args: ["completions", "bash", "zsh"], code: "commander.excessArguments" },
];

for (const { args, code } of invalidArgs) {
  it(`rejects ${args.join(" ")} before any action or lifecycle callback`, async () => {
    const app = setup();
    await assert.rejects(app.parse(args), { code, exitCode: 1 });
    assert.deepEqual(app.calls, []);
    assert.deepEqual(app.events, []);
    assert.equal(app.stdout.join(""), "");
    assert.match(app.stderr.join(""), /^error:/);
  });
}

for (const args of [["--help"], ["-h"], ["help"]]) {
  it(`shows canonical root help for ${args.join(" ")}`, async () => {
    const app = setup();
    await assert.rejects(app.parse(args), (error: unknown) => {
      assert.ok(error instanceof CommanderError);
      assert.equal(error.exitCode, 0);
      return true;
    });
    const help = app.stdout.join("");
    assert.match(help, /^Usage: gsmart \[options\]/);
    assert.match(help, /--provider/);
    assert.match(help, /--dry-run/);
    assert.match(help, /--debug/);
    assert.match(help, /^\s+config\b/m);
    assert.match(help, /^\s+help\b/m);
    assert.doesNotMatch(help, /^\s+generate\b/m);
    assert.deepEqual(app.calls, []);
    assert.deepEqual(app.events, []);
    assert.equal(app.stderr.join(""), "");
  });
}

for (const args of [
  ["generate", "--help"],
  ["help", "generate"],
]) {
  it(`shows inherited generation options for ${args.join(" ")}`, async () => {
    const app = setup();
    await assert.rejects(app.parse(args), { exitCode: 0 });
    const help = app.stdout.join("");
    assert.match(help, /^Usage: gsmart generate/);
    assert.match(help, /--prompt/);
    assert.match(help, /--provider/);
    assert.match(help, /--yes/);
    assert.match(help, /--dry-run/);
    assert.deepEqual(app.calls, []);
    assert.deepEqual(app.events, []);
    assert.equal(app.stderr.join(""), "");
  });
}

for (const args of [
  ["config", "--help"],
  ["help", "config"],
  ["--debug", "completions", "--help"],
  ["help", "completions"],
]) {
  it(`keeps subcommand help side-effect free for ${args.join(" ")}`, async () => {
    const app = setup();
    await assert.rejects(app.parse(args), { exitCode: 0 });
    assert.match(app.stdout.join(""), /^Usage: gsmart (config|completions)/);
    assert.deepEqual(app.events, []);
    assert.deepEqual(app.calls, []);
    assert.equal(app.stderr.join(""), "");
  });
}

for (const args of [
  ["--version"],
  ["-V"],
  ["generate", "--version"],
  ["-D", "-V"],
]) {
  it(`prints only the version for ${args.join(" ")}`, async () => {
    const app = setup();
    await assert.rejects(app.parse(args), {
      code: "commander.version",
      exitCode: 0,
    });
    assert.equal(app.stdout.join(""), "1.2.3\n");
    assert.equal(app.stderr.join(""), "");
    assert.deepEqual(app.events, []);
    assert.deepEqual(app.calls, []);
  });
}

it("awaits debug, startup, action, and completion callbacks in order", async () => {
  const order: string[] = [];
  const callback = (name: string) => async () => {
    order.push(`${name}:start`);
    await setImmediate();
    order.push(`${name}:end`);
  };
  const app = setup({
    onDebug: callback("debug"),
    beforeAction: callback("startup"),
    action: callback("action"),
    afterAction: callback("completion"),
  });
  await app.parse(["--debug"]);
  assert.deepEqual(order, [
    "debug:start",
    "debug:end",
    "startup:start",
    "startup:end",
    "action:start",
    "action:end",
    "completion:start",
    "completion:end",
  ]);
});

for (const args of [[], ["generate"], ["login"], ["completions", "bash"]]) {
  it(`propagates a rejected ${JSON.stringify(args)} action and skips completion output`, async () => {
    const failure = new Error("action failed asynchronously");
    const app = setup({
      action: async () => {
        await setImmediate();
        throw failure;
      },
    });
    await assert.rejects(app.parse(args), (error) => error === failure);
    assert.equal(app.calls.length, 1);
    assert.ok(app.events.every((event) => !event.startsWith("after:")));
  });
}

for (const hook of ["onDebug", "beforeAction", "afterAction"] as const) {
  it(`propagates an asynchronous ${hook} failure through parseAsync`, async () => {
    const failure = new Error(`${hook} failed`);
    const app = setup({
      [hook]: async () => {
        await setImmediate();
        throw failure;
      },
    });
    await assert.rejects(app.parse(["--debug"]), (error) => error === failure);
    assert.equal(app.calls.length, hook === "afterAction" ? 1 : 0);
  });
}

it("supports optional positional choices from injected descriptors without lifecycle callbacks", async () => {
  const calls: Record<string, unknown>[] = [];
  const descriptor: ICommand = {
    name: "inspect",
    description: "Inspect a format",
    arguments: [
      { name: "format", description: "Format", choices: ["text", "json"] },
    ],
    action: (options) => {
      calls.push(options);
    },
  };
  for (const args of [["inspect"], ["inspect", "json"]]) {
    await createProgram({ metadata, commands: [descriptor] }).parseAsync(args, {
      from: "user",
    });
  }
  assert.deepEqual(calls, [
    { debug: false, format: undefined },
    { debug: false, format: "json" },
  ]);
});

for (const args of [[], ["generate"]]) {
  it(`reports asynchronous entrypoint failures for ${JSON.stringify(args)} without unhandled rejections`, () => {
    const script = `
      import esmock from "esmock";
      import commands from "./src/gsmart.ts";
      import { setImmediate } from "node:timers/promises";

      process.argv = ["node", "gsmart", ...${JSON.stringify(args)}];
      await esmock("../src/index.ts", ${JSON.stringify(import.meta.url)}, {
        "../src/gsmart.ts": {
          default: commands.map(command => ({
            ...command,
            action: async () => {
              await setImmediate();
              throw new Error("generation failed asynchronously");
            },
          })),
        },
        "../src/utils/version-check.ts": { checkForUpdates: () => {} },
        "../src/utils/welcome.ts": { showWelcomeOnce: () => {} },
        "../src/utils/holiday.ts": { showHolidayMessage: () => console.log("holiday") },
      });
    `;
    const result = spawnSync(
      process.execPath,
      [
        "--unhandled-rejections=strict",
        "--import",
        "./test-support/register-esmock.mjs",
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        script,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    // Node may also emit runtime diagnostics, such as esmock's DEP0205 warning.
    assert.deepEqual(
      result.stderr.match(/^error:.*$/gm),
      ["error: generation failed asynchronously"],
      result.stderr,
    );
    assert.doesNotMatch(
      result.stderr,
      /[Uu]nhandled(?:Promise)?Rejection|[Uu]ncaughtException|^\w*Error:|^\s+at\s/m,
    );
  });
}
