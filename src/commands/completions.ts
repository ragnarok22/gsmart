import { ICommand, Option } from "../definitions";
import { getActiveProviders } from "../utils/providers";
import MainCommand from "./main";
import LoginCommand from "./login";
import ResetCommand from "./reset";

type CompletionsOptions = { shell: string };

type ParsedFlag = {
  short?: string;
  long?: string;
  takesValue: boolean;
  description: string;
};

export function parseFlag(option: Option): ParsedFlag {
  const result: ParsedFlag = {
    takesValue: option.flags.includes("<"),
    description: option.description,
  };

  for (const part of option.flags.split(",")) {
    const token = part.trim().split(/\s/)[0];
    if (token.startsWith("--")) {
      result.long = token.slice(2);
    } else if (token.startsWith("-")) {
      result.short = token.slice(1);
    }
  }

  return result;
}

export function generateBashCompletion(
  commands: ICommand[],
  flagValues: Record<string, string[]>,
): string {
  const commandNames = commands.map((c) => c.name).join(" ");

  const commandCases = commands
    .map((cmd) => {
      const flags = (cmd.options || []).map(parseFlag);
      const flagTokens = flags.flatMap((f) =>
        [f.short ? `-${f.short}` : "", f.long ? `--${f.long}` : ""].filter(
          Boolean,
        ),
      );
      const argChoices = (cmd.arguments || []).flatMap((a) => a.choices || []);
      const allTokens = [...flagTokens, ...argChoices, "-h", "--help"];

      return `        ${cmd.name})
            COMPREPLY=($(compgen -W "${allTokens.join(" ")}" -- "$cur"))
            ;;`;
    })
    .join("\n");

  const valueCases = Object.entries(flagValues)
    .map(([flagName, values]) => {
      const parsed = commands
        .flatMap((c) => (c.options || []).map(parseFlag))
        .find((f) => f.long === flagName);
      const triggers = [
        `--${flagName}`,
        parsed?.short ? `-${parsed.short}` : "",
      ]
        .filter(Boolean)
        .join("|");

      return `        ${triggers})
            COMPREPLY=($(compgen -W "${values.join(" ")}" -- "$cur"))
            ;;`;
    })
    .join("\n");

  return `# bash completion for gsmart
_gsmart_completions() {
    local cur prev commands
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    commands="${commandNames}"

    case "$prev" in
        gsmart)
            COMPREPLY=($(compgen -W "$commands -V --version -h --help" -- "$cur"))
            ;;
${commandCases}
${valueCases}
        *)
            COMPREPLY=($(compgen -W "$commands -V --version -h --help" -- "$cur"))
            ;;
    esac
}
complete -F _gsmart_completions gsmart
`;
}

export function generateZshCompletion(
  commands: ICommand[],
  flagValues: Record<string, string[]>,
): string {
  const commandList = commands
    .map((c) => `        '${c.name}:${c.description}'`)
    .join("\n");

  const argCases = commands
    .filter(
      (cmd) =>
        (cmd.options && cmd.options.length > 0) ||
        (cmd.arguments && cmd.arguments.length > 0),
    )
    .map((cmd) => {
      const flags = (cmd.options || []).map(parseFlag);

      if (flags.length === 0 && cmd.arguments) {
        const argLines = cmd.arguments
          .filter((a) => a.choices)
          .map(
            (a) =>
              `                    _arguments '1:${a.name}:(${a.choices!.join(" ")})'`,
          );
        return `                ${cmd.name})\n${argLines.join("\n")}
                    ;;`;
      }

      const flagLines = flags.flatMap((f) => {
        const lines: string[] = [];
        const valueCompletion =
          f.long && flagValues[f.long]
            ? `(${flagValues[f.long].join(" ")})`
            : "";
        const valueSpec = f.takesValue
          ? `:${f.long || "value"}:${valueCompletion}`
          : "";
        if (f.short) {
          lines.push(`'-${f.short}[${f.description}]${valueSpec}'`);
        }
        if (f.long) {
          lines.push(`'--${f.long}[${f.description}]${valueSpec}'`);
        }
        return lines;
      });

      flagLines.push(`'-h[display help]'`);
      flagLines.push(`'--help[display help]'`);

      const indented = flagLines
        .map((l) => `                        ${l}`)
        .join(" \\\n");

      return `                ${cmd.name})
                    _arguments \\
${indented}
                    ;;`;
    })
    .join("\n");

  return `#compdef gsmart

_gsmart() {
    local -a commands
    commands=(
${commandList}
    )

    _arguments -C \\
        '-V[display version]' \\
        '--version[display version]' \\
        '-h[display help]' \\
        '--help[display help]' \\
        '1:command:->command' \\
        '*::arg:->args'

    case $state in
        command)
            _describe -t commands 'gsmart commands' commands
            ;;
        args)
            case $words[1] in
${argCases}
            esac
            ;;
    esac
}

compdef _gsmart gsmart
`;
}

export function generateFishCompletion(
  commands: ICommand[],
  flagValues: Record<string, string[]>,
): string {
  const lines: string[] = [
    "# fish completion for gsmart",
    "",
    "# Disable file completions for gsmart",
    "complete -c gsmart -f",
    "",
    "# Top-level commands",
  ];

  for (const cmd of commands) {
    lines.push(
      `complete -c gsmart -n '__fish_use_subcommand' -a ${cmd.name} -d '${cmd.description}'`,
    );
  }

  lines.push("", "# Global flags");
  lines.push("complete -c gsmart -s V -l version -d 'Display version'");
  lines.push("complete -c gsmart -s h -l help -d 'Display help'");

  for (const cmd of commands) {
    const flags = (cmd.options || []).map(parseFlag);
    const argChoices = (cmd.arguments || []).flatMap((a) => a.choices || []);

    if (flags.length === 0 && argChoices.length === 0) continue;

    lines.push(
      "",
      `# ${cmd.name.charAt(0).toUpperCase() + cmd.name.slice(1)} options`,
    );

    for (const flag of flags) {
      const parts = [
        "complete -c gsmart",
        `-n '__fish_seen_subcommand_from ${cmd.name}'`,
      ];
      if (flag.short) parts.push(`-s ${flag.short}`);
      if (flag.long) parts.push(`-l ${flag.long}`);
      parts.push(`-d '${flag.description}'`);

      if (flag.takesValue) {
        parts.push("-r");
        if (flag.long && flagValues[flag.long]) {
          parts.push(`-a '${flagValues[flag.long].join(" ")}'`);
        }
      }

      lines.push(parts.join(" "));
    }

    if (argChoices.length > 0) {
      lines.push(
        `complete -c gsmart -n '__fish_seen_subcommand_from ${cmd.name}' -a '${argChoices.join(" ")}' -d '${cmd.arguments?.[0]?.description || ""}'`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

const CompletionsCommand: ICommand = {
  name: "completions",
  description: "Output shell completion script for bash, zsh, or fish",
  arguments: [
    {
      name: "shell",
      description: "Shell type",
      required: true,
      choices: ["bash", "zsh", "fish"],
    },
  ],
  action: (opts) => {
    const { shell } = opts as unknown as CompletionsOptions;
    const allCommands = [
      MainCommand,
      LoginCommand,
      ResetCommand,
      CompletionsCommand,
    ];
    const providerValues = getActiveProviders().map((p) => p.value);
    const flagValues = { provider: providerValues };

    const generators: Record<string, () => string> = {
      bash: () => generateBashCompletion(allCommands, flagValues),
      zsh: () => generateZshCompletion(allCommands, flagValues),
      fish: () => generateFishCompletion(allCommands, flagValues),
    };

    process.stdout.write(generators[shell]());
  },
};

export default CompletionsCommand;
