import { ICommand } from "../definitions";
import { getActiveProviders } from "../utils/providers";

type CompletionsOptions = { shell: string };

const getProviderValues = (): string => {
  return getActiveProviders()
    .map((p) => p.value)
    .join(" ");
};

export function generateBashCompletion(): string {
  const providers = getProviderValues();

  return `# bash completion for gsmart
_gsmart_completions() {
    local cur prev commands
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    commands="generate login reset completions"

    case "$prev" in
        gsmart)
            COMPREPLY=($(compgen -W "$commands -V --version -h --help" -- "$cur"))
            ;;
        generate)
            COMPREPLY=($(compgen -W "-p --prompt -P --provider -y --yes -h --help" -- "$cur"))
            ;;
        --provider|-P)
            COMPREPLY=($(compgen -W "${providers}" -- "$cur"))
            ;;
        reset)
            COMPREPLY=($(compgen -W "-f --force -h --help" -- "$cur"))
            ;;
        completions)
            COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))
            ;;
        login)
            COMPREPLY=($(compgen -W "-h --help" -- "$cur"))
            ;;
        *)
            COMPREPLY=($(compgen -W "$commands -V --version -h --help" -- "$cur"))
            ;;
    esac
}
complete -F _gsmart_completions gsmart
`;
}

export function generateZshCompletion(): string {
  const providers = getProviderValues();

  return `#compdef gsmart

_gsmart() {
    local -a commands
    commands=(
        'generate:Generate a commit message based on the changes in the staging area'
        'login:Login to a provider to use their AI service'
        'reset:Reset the API key for all providers and remove the configuration file'
        'completions:Output shell completion script for bash, zsh, or fish'
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
                generate)
                    _arguments \\
                        '-p[custom AI prompt]:prompt:' \\
                        '--prompt[custom AI prompt]:prompt:' \\
                        '-P[AI provider]:provider:(${providers})' \\
                        '--provider[AI provider]:provider:(${providers})' \\
                        '-y[auto-stage and commit without prompts]' \\
                        '--yes[auto-stage and commit without prompts]' \\
                        '-h[display help]' \\
                        '--help[display help]'
                    ;;
                reset)
                    _arguments \\
                        '-f[force reset the configuration]' \\
                        '--force[force reset the configuration]' \\
                        '-h[display help]' \\
                        '--help[display help]'
                    ;;
                completions)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
            esac
            ;;
    esac
}

compdef _gsmart gsmart
`;
}

export function generateFishCompletion(): string {
  const providers = getProviderValues();

  return `# fish completion for gsmart

# Disable file completions for gsmart
complete -c gsmart -f

# Top-level commands
complete -c gsmart -n '__fish_use_subcommand' -a generate -d 'Generate a commit message based on the changes in the staging area'
complete -c gsmart -n '__fish_use_subcommand' -a login -d 'Login to a provider to use their AI service'
complete -c gsmart -n '__fish_use_subcommand' -a reset -d 'Reset the API key for all providers and remove the configuration file'
complete -c gsmart -n '__fish_use_subcommand' -a completions -d 'Output shell completion script for bash, zsh, or fish'

# Global flags
complete -c gsmart -s V -l version -d 'Display version'
complete -c gsmart -s h -l help -d 'Display help'

# Generate options
complete -c gsmart -n '__fish_seen_subcommand_from generate' -s p -l prompt -d 'Custom AI prompt' -r
complete -c gsmart -n '__fish_seen_subcommand_from generate' -s P -l provider -d 'AI provider' -r -a '${providers}'
complete -c gsmart -n '__fish_seen_subcommand_from generate' -s y -l yes -d 'Auto-stage and commit without prompts'

# Reset options
complete -c gsmart -n '__fish_seen_subcommand_from reset' -s f -l force -d 'Force reset the configuration'

# Completions argument
complete -c gsmart -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish' -d 'Shell type'
`;
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

    const generators: Record<string, () => string> = {
      bash: generateBashCompletion,
      zsh: generateZshCompletion,
      fish: generateFishCompletion,
    };

    process.stdout.write(generators[shell]());
  },
};

export default CompletionsCommand;
