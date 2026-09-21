import { ICommand, Option } from "../definitions";
import { getActiveProviders } from "../utils/providers";
import MainCommand from "./main";
import LoginCommand from "./login";
import ResetCommand from "./reset";
import ConfigCommand from "./config";

type CompletionsOptions = { shell: string };
type FlagValues = Record<string, string[]>;

type ParsedFlag = {
  short?: string;
  long?: string;
  takesValue: boolean;
  description: string;
};

const globalOptions: Option[] = [
  { flags: "-V, --version", description: "Display version" },
  { flags: "-D, --debug", description: "Enable debug logging" },
  { flags: "-h, --help", description: "Display help" },
];

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const fishQuote = (value: string) =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const flagTokens = (flag: ParsedFlag) =>
  [flag.short && `-${flag.short}`, flag.long && `--${flag.long}`].filter(
    (token): token is string => Boolean(token),
  );

export function parseFlag(option: Option): ParsedFlag {
  const result: ParsedFlag = {
    takesValue: option.flags.includes("<"),
    description: option.description,
  };

  for (const part of option.flags.split(",")) {
    const token = part.trim().split(/\s/)[0];
    if (token.startsWith("--")) result.long = token.slice(2);
    else if (token.startsWith("-")) result.short = token.slice(1);
  }

  return result;
}

function completionContexts(commands: ICommand[]) {
  return [
    { name: "root", command: commands.find((command) => command.default) },
    ...commands.map((command) => ({ name: command.name, command })),
    { name: "help", command: undefined },
  ];
}

function visibleCommands(commands: ICommand[]) {
  return [
    ...commands.filter((command) => !command.default),
    { name: "help", description: "Display help for a command" },
  ];
}

// Only required option values need special treatment. In particular, their
// contents must never be interpreted as commands (e.g. --prompt config).
function valueFlags(commands: ICommand[]) {
  return completionContexts(commands).flatMap(({ name, command }) =>
    (command?.options || [])
      .map(parseFlag)
      .filter((flag) => flag.takesValue)
      .map((flag) => ({ context: name, flag })),
  );
}

function shortBooleanPrefixes(commands: ICommand[]) {
  return completionContexts(commands).flatMap(({ name, command }) =>
    [...(command?.options || []), ...globalOptions]
      .map(parseFlag)
      .filter((flag) => flag.short && !flag.takesValue)
      .map((flag) => `${name}:-${flag.short}`),
  );
}

// Peel boolean prefixes from short clusters, leaving the value-taking option
// intact: -Dypconfig -> -pconfig, and -DP -> -P followed by a separate value.
function shellShortOptions(commands: ICommand[], rememberPrefix = false) {
  const patterns = shortBooleanPrefixes(commands)
    .map((prefix) => `${quote(prefix)}?*`)
    .join("|");
  return `        while :; do
            case "$context:$word" in
                ${patterns})
                    ${rememberPrefix ? 'short_prefix="$short_prefix${word:1:1}"' : ":"}
                    word="-\${word#??}"
                    ;;
                *) break ;;
            esac
        done`;
}

// Bash and Zsh share this small scanner; Zsh still delegates option/value
// completion to _arguments. Keep the syntax compatible with macOS Bash 3.2.
function shellContext(commands: ICommand[], shell: "bash" | "zsh") {
  const valueCases = valueFlags(commands)
    .map(({ context, flag }) => {
      const separate = flagTokens(flag)
        .map((token) => quote(`${context}:${token}`))
        .join("|");
      const attached = [
        flag.long && `${quote(`${context}:--${flag.long}=`)}*`,
        flag.short && `${quote(`${context}:-${flag.short}`)}?*`,
      ]
        .filter(Boolean)
        .join("|");
      return `            ${separate}) pending=${quote(flag.long || flag.short!)}; continue ;;
            ${attached}) continue ;;`;
    })
    .join("\n");
  const names = [...commands.map((command) => command.name), "help"];
  const words = shell === "bash" ? "COMP_WORDS" : "words";
  const current = shell === "bash" ? "COMP_CWORD" : "CURRENT";
  return `    local context=root pending='' end_options=0 positional=0 command_index=0 i word
    for ((i=${shell === "bash" ? 1 : 2}; i<${current}; i++)); do
        word="\${${words}[i]}"
        if [[ -n "$pending" ]]; then
            ${shell === "bash" ? '# Readline may split --provider=value at "=".\n            [[ "$word" == = ]] && continue' : ":"}
            pending=''
            continue
        fi
        if ((end_options)); then
            ((positional+=1))
            continue
        fi
${shellShortOptions(commands)}
        case "$context:$word" in
${valueCases}
        esac
        case "$word" in
            --) end_options=1; continue ;;
            -*) continue ;;
        esac
        if [[ "$context" == root ]] && ((positional == 0)); then
            case "$word" in
                ${names.map(quote).join("|")}) context="$word"; command_index=$i; continue ;;
            esac
        fi
        ((positional+=1))
    done`;
}

export function generateBashCompletion(
  commands: ICommand[],
  flagValues: FlagValues,
): string {
  const names = visibleCommands(commands).map((command) => command.name);
  const contexts = completionContexts(commands);
  const options = contexts
    .map(({ name, command }) => {
      const tokens = [...(command?.options || []), ...globalOptions]
        .map(parseFlag)
        .flatMap(flagTokens);
      return `            ${quote(name)}) candidates=(${tokens.map(quote).join(" ")}) ;;`;
    })
    .join("\n");
  const argumentsCases = contexts
    .flatMap(({ name, command }) =>
      (command?.arguments || []).map(
        (argument, index) =>
          `            ${quote(`${name}:${index}`)}) candidates+=( ${(argument.choices || []).map(quote).join(" ")} ) ;;`,
      ),
    )
    .join("\n");
  const attachedCases = valueFlags(commands)
    .flatMap(({ context, flag }) =>
      [flag.long && `--${flag.long}=`, flag.short && `-${flag.short}`]
        .filter((prefix): prefix is string => Boolean(prefix))
        .map(
          (prefix) => `            ${quote(`${context}:${prefix}`)}*)
                pending=${quote(flag.long || flag.short!)}
                prefix=${quote(prefix)}
                cur="\${word#"$prefix"}"
                prefix="-$short_prefix\${prefix#-}"
                ;;`,
        ),
    )
    .join("\n");
  const values = valueFlags(commands)
    .map(
      ({ context, flag }) =>
        `            ${quote(`${context}:${flag.long || flag.short}`)}) candidates=(${(flagValues[flag.long || ""] || []).map(quote).join(" ")}) ;;`,
    )
    .join("\n");

  return `# bash completion for gsmart
_gsmart_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}" prefix='' short_prefix='' candidate
    local -a candidates
    COMPREPLY=()
${shellContext(commands, "bash")}
    if [[ -n "$pending" ]]; then
        cur="\${cur#=}"
    elif ((!end_options)); then
        word="$cur"
${shellShortOptions(commands, true)}
        case "$context:$word" in
${attachedCases}
        esac
    fi
    if [[ -n "$pending" ]]; then
        case "$context:$pending" in
${values}
        esac
    else
        if ((!end_options)); then
            case "$context" in
${options}
            esac
            if [[ "$context" == root || "$context" == help ]] && ((positional == 0)); then
                candidates+=(${names.map(quote).join(" ")})
            fi
        fi
        case "$context:$positional" in
${argumentsCases}
        esac
    fi
    for candidate in "\${candidates[@]}"; do
        [[ "$candidate" == "$cur"* ]] && COMPREPLY+=("$prefix$candidate")
    done
    return 0
}
complete -F _gsmart_completions gsmart
`;
}

export function generateZshCompletion(
  commands: ICommand[],
  flagValues: FlagValues,
): string {
  // _arguments/_describe have their own delimiters, in addition to shell syntax.
  const escapeSpec = (value: string) => value.replace(/[\\[\]:]/g, "\\$&");
  const states: string[] = [];
  const valueAction = (values: string[]) => {
    const state = `values${states.length}`;
    states.push(
      `        ${state}) compadd -- ${values.map(quote).join(" ")} ;;`,
    );
    return `->${state}`;
  };
  const contexts = completionContexts(commands)
    .map(({ name, command }) => {
      const specs = [...(command?.options || []), ...globalOptions]
        .map(parseFlag)
        .flatMap((flag) => {
          const values = flagValues[flag.long || ""];
          const argument = flag.takesValue
            ? `:${escapeSpec(flag.long || "value")}:${values?.length ? valueAction(values) : ""}`
            : "";
          return flagTokens(flag).map((token) =>
            quote(
              `${token}${flag.takesValue ? (token.startsWith("--") ? "=" : "+") : ""}[${escapeSpec(flag.description)}]${argument}`,
            ),
          );
        });
      if (name === "root" || name === "help") {
        specs.push(quote("1:command:->command"));
      } else {
        for (const [index, argument] of (command?.arguments || []).entries()) {
          specs.push(
            quote(
              `${index + 1}:${escapeSpec(argument.description)}:${argument.choices?.length ? valueAction(argument.choices) : ""}`,
            ),
          );
        }
      }
      return `        ${quote(name)})
            _arguments -s -S -C \\
                ${specs.join(" \\\n                ")}
            ;;`;
    })
    .join("\n");
  const names = visibleCommands(commands)
    .map((command) =>
      quote(`${escapeSpec(command.name)}:${escapeSpec(command.description)}`),
    )
    .join("\n        ");

  return `#compdef gsmart

_gsmart() {
    local curcontext="$curcontext" state state_descr
    local -a line commands
    local -A opt_args
    local -a words=("\${words[@]}")
    local CURRENT=$CURRENT
${shellContext(commands, "zsh")}
    if ((command_index)); then
        words=("\${(@)words[command_index,-1]}")
        ((CURRENT -= command_index - 1))
        curcontext="\${curcontext%:*:*}:gsmart-$context:"
    fi
    commands=(
        ${names}
    )
    case "$context" in
${contexts}
    esac
    case "$state" in
        command)
            if ((!end_options && positional == 0)); then
                _describe -t commands 'gsmart commands' commands
            fi
            ;;
${states.join("\n")}
    esac
}

compdef _gsmart gsmart
`;
}

export function generateFishCompletion(
  commands: ICommand[],
  flagValues: FlagValues,
): string {
  const valueCases = valueFlags(commands)
    .map(({ context, flag }) => {
      const separate = flagTokens(flag).map((token) =>
        fishQuote(`${context}:${token}`),
      );
      const attached = [
        flag.long && `${context}:--${flag.long}=*`,
        flag.short && `${context}:-${flag.short}*`,
      ].filter((pattern): pattern is string => Boolean(pattern));
      return `            case ${separate.join(" ")}
                set pending 1
                continue
            case ${attached.map(fishQuote).join(" ")}
                continue`;
    })
    .join("\n");
  const lines = [
    `# fish completion for gsmart
function __gsmart_context
    set -l words (commandline -opc)
    set -l context root
    set -l pending 0
    set -l end_options 0
    set -l positional 0
    for word in $words[2..-1]
        if test $pending = 1
            set pending 0
            continue
        end
        if test $end_options = 1
            set positional (math $positional + 1)
            continue
        end
        # Do not rely on '?' wildcards: modern Fish disables them by default.
        while test (string length -- "$word") -gt 2
            switch "$context:$word"
                case ${shortBooleanPrefixes(commands)
                  .map((prefix) => fishQuote(`${prefix}*`))
                  .join(" ")}
                    set word -(string sub -s 3 -- $word)
                case '*'
                    break
            end
        end
        switch "$context:$word"
${valueCases}
        end
        switch $word
            case --
                set end_options 1
                continue
            case '-*'
                continue
        end
        if test $context = root; and test $positional = 0
            switch $word
                case ${[...commands.map((command) => command.name), "help"].map(fishQuote).join(" ")}
                    set context $word
                    continue
            end
        end
        set positional (math $positional + 1)
    end
    switch $argv[1]
        case global
            test $end_options = 0
        case options
            test $end_options = 0; and contains -- $context $argv[2..-1]
        case commands
            test $end_options = 0; and test $pending = 0; and test $positional = 0; and contains -- $context root help
        case argument
            test $pending = 0; and test $context = $argv[2]; and test $positional = $argv[3]
    end
end

# Disable file completions, including for free-form prompt values.
complete -c gsmart -f`,
  ];
  const choices = (values: string[]) =>
    fishQuote(values.map(fishQuote).join(" "));
  for (const command of visibleCommands(commands)) {
    lines.push(
      `complete -c gsmart -n '__gsmart_context commands' -a ${choices([command.name])} -d ${fishQuote(command.description)}`,
    );
  }
  const addOption = (option: Option, condition: string) => {
    const flag = parseFlag(option);
    const parts = ["complete -c gsmart", `-n ${fishQuote(condition)}`];
    if (flag.short) parts.push(`-s ${fishQuote(flag.short)}`);
    if (flag.long) parts.push(`-l ${fishQuote(flag.long)}`);
    parts.push(`-d ${fishQuote(flag.description)}`);
    if (flag.takesValue) {
      // Fish's command-wide -f does not disable files for option arguments.
      parts.push("-r", "-f");
      if (flag.long && flagValues[flag.long]) {
        parts.push(`-a ${choices(flagValues[flag.long])}`);
      }
    }
    lines.push(parts.join(" "));
  };
  for (const option of globalOptions)
    addOption(option, "__gsmart_context global");
  for (const { name, command } of completionContexts(commands)) {
    for (const option of command?.options || []) {
      addOption(option, `__gsmart_context options ${fishQuote(name)}`);
    }
    for (const [index, argument] of (command?.arguments || []).entries()) {
      if (argument.choices?.length) {
        lines.push(
          `complete -c gsmart -n ${fishQuote(`__gsmart_context argument ${fishQuote(name)} ${index}`)} -a ${choices(argument.choices)} -d ${fishQuote(argument.description)}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

const CompletionsCommand: ICommand = {
  name: "completions",
  description: "Output shell completion script for bash, zsh, or fish",
  silent: true,
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
      ConfigCommand,
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
