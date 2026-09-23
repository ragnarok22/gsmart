import "../test-support/setup-env";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ICommand } from "../src/definitions.ts";
import commands from "../src/gsmart.ts";
import CompletionsCommand, {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "../src/commands/completions.ts";
import { getActiveProviders } from "../src/utils/providers.ts";

const providers = getActiveProviders().map((provider) => provider.value);
const flagValues = { provider: providers, "default-provider": providers };
const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;
const fishQuote = (word: string) =>
  `'${word.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const commandLine = (words: string[], quoteWord = quote) =>
  words
    .map((word, index) =>
      (!word && index === words.length - 1) || /^[\w=:+,./-]+$/.test(word)
        ? word
        : quoteWord(word),
    )
    .join(" ");
const shells = {
  bash: process.env.GSMART_TEST_BASH || "bash",
  zsh: process.env.GSMART_TEST_ZSH || "zsh",
  fish: process.env.FISH || "fish",
};

function available(executable: string): boolean {
  return spawnSync(executable, ["--version"]).status === 0;
}

function shellTestOptions(shell: keyof typeof shells) {
  const installed = available(shells[shell]);
  if (process.env.GSMART_REQUIRE_SHELL_TESTS === "1") {
    assert.ok(installed, `${shell} is required`);
  }
  if (shell === "zsh" && installed)
    assert.ok(available("python3"), "Python 3 is required for Zsh's ZLE tests");
  return { skip: installed ? false : `${shell} runtime unavailable` };
}

function runShell(shell: string, script: string): string[] {
  const args = shell === "bash" ? ["--noprofile", "--norc"] : ["-f"];
  const result = spawnSync(shells[shell as "bash" | "zsh"], args, {
    input: script,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.trim().split("\n").filter(Boolean);
}

function completeBash(
  words: string[],
  registry = commands,
  values: Record<string, string[]> = flagValues,
): string[] {
  return runShell(
    "bash",
    `${generateBashCompletion(registry, values)}
COMP_WORDS=(${words.map(quote).join(" ")})
COMP_CWORD=${words.length - 1}
_gsmart_completions
printf '%s\\n' "\${COMPREPLY[@]}"
`,
  );
}

function completeZsh(
  words: string[],
  registry = commands,
  values: Record<string, string[]> = flagValues,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const result = spawnSync(
    "python3",
    [
      fileURLToPath(
        new URL("../test-support/complete-zsh.py", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify({
        shell: shells.zsh,
        script: generateZshCompletion(registry, values),
        line: commandLine(words),
      }),
      encoding: "utf8",
      timeout: 15_000,
      env,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

it(
  "initializes Zsh despite an unrelated insecure fpath directory",
  shellTestOptions("zsh"),
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "gsmart-insecure-fpath-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    chmodSync(directory, 0o777);
    writeFileSync(
      join(directory, "_gsmart_unrelated"),
      "#compdef unrelated\nreturn 1\n",
    );
    const paths = spawnSync(shells.zsh, ["-fc", "print -rl -- $fpath"], {
      encoding: "utf8",
    });
    assert.equal(paths.status, 0, paths.stderr);
    const matches = completeZsh(["gsmart", "--"], commands, flagValues, {
      ...process.env,
      FPATH: [directory, ...paths.stdout.trim().split("\n")].join(":"),
    });
    assert.ok(matches.includes("--yes"));
  },
);

function completeFish(
  words: string[],
  registry = commands,
  values: Record<string, string[]> = flagValues,
): string[] {
  const script = `${generateFishCompletion(registry, values)}\ncomplete -C ${fishQuote(commandLine(words, fishQuote))}\n`;
  // Fish 3.x mistakes Node's socket-backed stdin for a directory.
  const result = spawnSync(shells.fish, ["--no-config", "-c", script], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((match) => match.split("\t")[0]);
}

function renderZshCompletion(line: string): string {
  const result = spawnSync(
    "python3",
    [
      fileURLToPath(
        new URL("../test-support/complete-zsh.py", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify({
        shell: shells.zsh,
        script: generateZshCompletion(commands, flagValues),
        line,
        display: true,
        // Oh My Zsh's standard matcher/menu settings; no plugins required.
        setup: `zmodload -i zsh/complist
zstyle ':completion:*:*:*:*:*' menu select
zstyle ':completion:*' matcher-list 'm:{[:lower:][:upper:]}={[:upper:][:lower:]}' 'r:|=*' 'l:|=* r:|=*'
zstyle ':completion:*' list-colors ''`,
      }),
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

describe("Zsh completion menu rendering", shellTestOptions("zsh"), () => {
  for (const line of [
    "gsmart -",
    "gsmart --",
    "gsmart generate -",
    "gsmart config -",
  ]) {
    it(`keeps options and descriptions together without duplicates for ${line}`, () => {
      const screen = renderZshCompletion(line);
      assert.equal((screen.match(/--debug\b/g) || []).length, 1, screen);
      const debugRow = screen
        .split(/\r?\n/)
        .find((row) => row.includes("--debug"));
      assert.ok(debugRow?.includes("Enable debug logging"), screen);
      if (!line.endsWith("--")) assert.ok(debugRow?.includes("-D"), screen);
      assert.equal(
        (screen.match(/Enable debug logging/g) || []).length,
        1,
        screen,
      );
    });
  }
});

describe("root-command completion behavior", () => {
  for (const [shell, complete] of Object.entries({
    bash: completeBash,
    zsh: completeZsh,
    fish: completeFish,
  })) {
    describe(
      `${shell} provider/model preferences`,
      shellTestOptions(shell as keyof typeof shells),
      () => {
        it("completes custom providers in config and treats model IDs as values", () => {
          assert.ok(
            complete(["gsmart", "config", "--default-provider", ""]).includes(
              "custom",
            ),
          );
          assert.ok(
            complete(["gsmart", "config", "--provider", ""]).includes("custom"),
          );
          assert.ok(
            complete(["gsmart", "--model", "config", "--"]).includes("--yes"),
          );
          assert.ok(
            complete(["gsmart", "config", "--model", "login", "--"]).includes(
              "--base-url",
            ),
          );
        });
      },
    );
  }
  describe("bash regressions", shellTestOptions("bash"), () => {
    it("offers generation flags directly after gsmart in bash", () => {
      const matches = completeBash(["gsmart", "--"]);
      for (const flag of [
        "--provider",
        "--model",
        "--prompt",
        "--yes",
        "--dry-run",
        "--debug",
      ]) {
        assert.ok(matches.includes(flag), `Missing root flag ${flag}`);
      }
    });

    it("hides the generate alias and includes config in bash suggestions", () => {
      const matches = completeBash(["gsmart", ""]);
      assert.ok(!matches.includes("generate"));
      for (const command of [
        "login",
        "config",
        "reset",
        "completions",
        "help",
      ]) {
        assert.ok(matches.includes(command), `Missing command ${command}`);
      }
    });

    for (const flag of ["--provider", "-P"]) {
      it(`completes provider values after ${flag} in bash`, () => {
        assert.deepEqual(completeBash(["gsmart", flag, ""]), providers);
      });
    }

    it("keeps root context after a provider value in bash", () => {
      assert.ok(
        completeBash(["gsmart", "--provider", "openai", "--"]).includes(
          "--yes",
        ),
      );
    });

    it("does not interpret prompt values as subcommands in bash", () => {
      const matches = completeBash(["gsmart", "--prompt", "config", "--"]);
      assert.ok(matches.includes("--yes"));
      assert.ok(!matches.includes("--show"));
    });

    it("retains the config context after one of its flags in bash", () => {
      const matches = completeBash([
        "gsmart",
        "--debug",
        "config",
        "--show",
        "--",
      ]);
      assert.ok(matches.includes("--add-custom-prompt"));
      assert.ok(!matches.includes("--yes"));
      assert.ok(!matches.includes("--force"));
    });

    it("supports explicit generate invocation in bash without suggesting it", () => {
      assert.ok(completeBash(["gsmart", "generate", "--"]).includes("--yes"));
    });

    it("completes the shell argument in bash", () => {
      const matches = completeBash(["gsmart", "completions", ""]);
      assert.deepEqual(
        matches.filter((match) => !match.startsWith("-")),
        ["bash", "zsh", "fish"],
      );
    });
  });

  it(
    "passes generation options to the root zsh completion context",
    shellTestOptions("zsh"),
    () => {
      const specs = runShell(
        "zsh",
        `compdef() { :; }
${generateZshCompletion(commands, flagValues)}
_arguments() { printf '%s\\n' "$@"; }
words=(gsmart --)
CURRENT=2
_gsmart
`,
      );
      assert.ok(specs.some((spec) => /--provider=?\[/.test(spec)));
      assert.ok(specs.some((spec) => spec.includes("--yes[")));
    },
  );

  for (const [shell, generate] of Object.entries({
    bash: generateBashCompletion,
    zsh: generateZshCompletion,
    fish: generateFishCompletion,
  })) {
    it(`emits the complete registered command inventory for ${shell}`, (t) => {
      const chunks: string[] = [];
      t.mock.method(process.stdout, "write", (chunk: string) => {
        chunks.push(chunk);
        return true;
      });
      CompletionsCommand.action({ shell });
      assert.equal(chunks.join(""), generate(commands, flagValues));
    });
  }
});

for (const [shell, complete] of Object.entries({
  bash: completeBash,
  zsh: completeZsh,
  fish: completeFish,
})) {
  describe(
    `${shell} native completion`,
    shellTestOptions(shell as keyof typeof shells),
    () => {
      it("offers root generation options and visible commands", () => {
        const options = complete(["gsmart", "--"]);
        for (const option of [
          "--yes",
          "--dry-run",
          "--prompt",
          "--provider",
          "--language",
          "--history-examples",
          "--help",
          "--debug",
          "--version",
        ]) {
          assert.ok(
            options.some((match) => match.replace(/=$/, "") === option),
            `Missing ${option}: ${options}`,
          );
        }
        const names = complete(["gsmart", ""]);
        for (const name of ["config", "login", "reset", "completions", "help"])
          assert.ok(names.includes(name), `Missing ${name}: ${names}`);
        assert.ok(!names.includes("generate"));
      });

      for (const before of [
        ["--language", "es"],
        ["--history-examples", "0"],
        ["--provider", "openai"],
        ["--provider=openai"],
        ["-Popenai"],
        ["--prompt", "config"],
        ["--prompt=reset"],
        ["-pconfig"],
        ["-Dp", "config"],
        ["-Dpconfig"],
        ["-DP", "openai"],
        ["--prompt", "generate"],
        ["--prompt", "help"],
        ["--prompt", "config --show"],
        ["--prompt", ""],
        ["generate", "--prompt", "config"],
        ["--debug", "generate", "--prompt", "config"],
      ]) {
        it(`retains generation context after ${before.join(" ")}`, () => {
          const matches = complete(["gsmart", ...before, "--"]);
          assert.ok(matches.includes("--yes"), `Missing --yes: ${matches}`);
          assert.ok(!matches.includes("--show"));
          assert.ok(!matches.includes("--force"));
        });
      }

      for (const before of [
        ["--provider"],
        ["-P"],
        ["-DP"],
        ["--debug", "--provider"],
        ["generate", "-P"],
      ]) {
        it(`offers only providers after ${before.join(" ")}`, () => {
          assert.deepEqual(
            complete(["gsmart", ...before, ""]).sort(),
            [...providers].sort(),
          );
        });
      }

      for (const prefix of ["--provider=op", "-Pop", "-DPop"]) {
        it(`completes an attached provider in ${prefix}`, () => {
          const matches = complete(["gsmart", prefix]);
          assert.deepEqual(
            matches.map((match) => match.replace(/^(--provider=|-D?P)/, "")),
            ["openai"],
          );
        });
      }

      it("does not suggest anything for a free-form prompt value", () => {
        assert.deepEqual(complete(["gsmart", "--prompt", ""]), []);
      });

      it("preserves literal values when generating shell code", () => {
        const values = ["owner's", "two words", "dollar$value", "slash\\path"];
        assert.deepEqual(
          complete(["gsmart", "--provider", ""], commands, {
            provider: values,
          }).sort(),
          [...values].sort(),
        );
      });

      for (const before of [
        ["config", "--show-effective"],
        ["config", "--show"],
        ["--debug", "config", "--show"],
        ["--provider", "openai", "config"],
        ["--provider=openai", "config"],
        ["-Popenai", "config"],
        ["--prompt", "reset", "config"],
        ["config", "--add-custom-prompt", "reset"],
        ["config", "--add-custom-prompt=reset"],
      ]) {
        it(`keeps config options after ${before.join(" ")}`, () => {
          const matches = complete(["gsmart", ...before, "--"]);
          if (!before.includes("--show-effective"))
            assert.ok(matches.includes("--show-effective"));
          assert.ok(
            matches.some(
              (match) => match.replace(/=$/, "") === "--add-custom-prompt",
            ) || matches.includes("--clear-custom-prompt"),
            `Missing config options: ${matches}`,
          );
          assert.ok(!matches.includes("--yes"));
          assert.ok(!matches.includes("--force"));
          assert.ok(matches.includes("--default-provider"));
        });
      }

      it("dispatches reset after global flags", () => {
        const matches = complete(["gsmart", "--debug", "reset", "--"]);
        assert.ok(matches.includes("--force"));
        assert.ok(!matches.includes("--yes"));
      });

      it("does not suggest sibling commands after a command", () => {
        const matches = complete(["gsmart", "login", ""]);
        for (const name of ["config", "reset", "generate", "completions"])
          assert.ok(!matches.includes(name));
      });

      it("offers config provider values without generation-only flags", () => {
        const options = complete(["gsmart", "config", "--p"]);
        assert.ok(options.includes("--provider"));
        assert.ok(!options.includes("--prompt"));
        // Fish can legitimately fuzzy-match --help and config's prompt flags.
        if (shell !== "fish") assert.deepEqual(options, ["--provider"]);
        const matches = complete(["gsmart", "config", "--provider", ""]);
        for (const provider of providers) assert.ok(matches.includes(provider));
      });

      it("offers shell choices once, after globals and the command", () => {
        assert.deepEqual(
          complete(["gsmart", "--debug", "completions", ""])
            .filter((match) => !match.startsWith("-"))
            .sort(),
          ["bash", "fish", "zsh"],
        );
        assert.deepEqual(
          complete(["gsmart", "completions", "bash", ""]).filter(
            (match) => !match.startsWith("-"),
          ),
          [],
        );
      });

      it("offers visible command names for help", () => {
        const matches = complete(["gsmart", "--debug", "help", ""]);
        assert.ok(matches.includes("config"));
        assert.ok(!matches.includes("generate"));
        assert.ok(!matches.includes("--yes"));
        assert.ok(
          !complete(["gsmart", "help", "config", "--"]).includes("--show"),
        );
      });

      it("stops suggesting options and commands after --", () => {
        assert.deepEqual(complete(["gsmart", "--", "--"]), []);
        assert.deepEqual(complete(["gsmart", "--", ""]), []);
        assert.deepEqual(complete(["gsmart", "--", "config", "--"]), []);
        assert.deepEqual(complete(["gsmart", "config", "--", "--"]), []);
      });

      it("uses the default command definition and escapes descriptions", () => {
        const description = "Owner's [choice]: $HOME `false` $(false) \\ value";
        const registry: ICommand[] = [
          {
            name: "legacy",
            default: true,
            description,
            options: [
              { flags: "--verbose", description },
              { flags: "-o <path>", description },
              { flags: "-P, --provider <value>", description },
            ],
            action: () => {},
          },
          { name: "bare", description, action: () => {} },
          {
            name: "choose",
            description,
            arguments: [
              { name: "mode", description, choices: ["fast", "safe"] },
            ],
            action: () => {},
          },
        ];
        const options = complete(["gsmart", "--"], registry);
        assert.ok(options.includes("--verbose"));
        const names = complete(["gsmart", ""], registry);
        assert.ok(names.includes("bare"));
        assert.ok(!names.includes("legacy"));
        assert.ok(
          !complete(["gsmart", "bare", "--"], registry).includes("--verbose"),
        );
        assert.ok(
          complete(["gsmart", "legacy", "--"], registry).includes("--verbose"),
        );
        assert.deepEqual(complete(["gsmart", "-o", ""], registry), []);
        assert.deepEqual(
          complete(["gsmart", "choose", ""], registry)
            .filter((match) => !match.startsWith("-"))
            .sort(),
          ["fast", "safe"],
        );
      });
    },
  );
}

describe("Bash Readline word breaks", shellTestOptions("bash"), () => {
  it("completes values when Readline separates the equals sign", () => {
    assert.deepEqual(completeBash(["gsmart", "--provider", "=", "op"]), [
      "openai",
    ]);
    assert.ok(
      completeBash(["gsmart", "--provider", "=", "openai", "--"]).includes(
        "--yes",
      ),
    );
  });
});
