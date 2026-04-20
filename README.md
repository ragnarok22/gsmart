> **The smart way to write your commit messages using AI** 🤖

GSmart is a CLI tool that automatically generates [Conventional Commits](https://www.conventionalcommits.org/) by analyzing your staged git changes. Simply stage your files and let AI craft the perfect commit message for you.

[![Test](https://github.com/ragnarok22/gsmart/actions/workflows/test.yml/badge.svg)](https://github.com/ragnarok22/gsmart/actions)
[![codecov](https://codecov.io/gh/ragnarok22/gsmart/graph/badge.svg?token=Bsj62uvl22)](https://codecov.io/gh/ragnarok22/gsmart)
[![NPM Downloads](https://img.shields.io/npm/dm/gsmart)](https://www.npmjs.com/package/gsmart)
[![NPM Version](https://img.shields.io/npm/v/gsmart)](https://www.npmjs.com/package/gsmart)
[![NPM License](https://img.shields.io/npm/l/gsmart)](https://github.com/ragnarok22/gsmart/blob/main/LICENSE)

![GSmart Demo](https://repository-images.githubusercontent.com/827045490/756cb1d5-9572-4cc2-be37-0459da007c1a)

## ✨ Features

- 🎯 **Smart Commit Messages**: AI-generated conventional commits based on your changes
- 🔄 **Multiple AI Providers**: Support for OpenAI, Anthropic, Google, Mistral, Fireworks AI, and PlataformIA
- 📋 **Interactive CLI**: Easy-to-use command line interface with interactive prompts
- 🧠 **Rename-Aware Staging**: Detects renames and copies so both sides get staged automatically
- 🔒 **Secure**: API keys stored locally and securely, validated before use
- ⏱️ **Timeout Protection**: Configurable request timeout prevents hanging on unresponsive APIs
- 🔁 **Automatic Retries**: Retries transient network errors with user feedback
- 🐛 **Debug Mode**: `--debug` flag for detailed logging and timing information
- 🧪 **Dry Run**: Preview staged files without committing using `--dry-run`
- ⚡ **Fast**: Quick analysis and generation of commit messages
- 📖 **Conventional Commits**: Follows industry-standard commit message format
- 🐚 **Shell Completions**: Tab completions for bash, zsh, and fish

## 🚀 Quick Start

### Installation

Install GSmart globally using npm or pnpm:

```bash
# Using npm
npm install -g gsmart

# Using pnpm
pnpm add -g gsmart

# Using yarn
yarn global add gsmart
```

### Setup

1. **Configure your AI provider** (one-time setup):

```bash
gsmart login
```

You'll be prompted to select a provider and enter your API key:

```
? Select a provider › Use arrow keys to navigate
❯ OpenAI
  Anthropic
  Google Gemini
  Mistral
  Fireworks AI
  PlataformIA
```

2. **Generate commit messages**:

```bash
# Stage your changes
git add .

# Generate and apply commit message
gsmart
```

That's it! GSmart will analyze your staged changes and generate a conventional commit message.

## 💡 Usage Examples

### Basic Usage

```bash
# Stage some files
git add src/components/Button.tsx

# Generate commit message
gsmart
# Output: "feat(components): add Button component with primary and secondary variants"
```

### Advanced Options

```bash
# Use a specific provider
gsmart --provider anthropic

# Use a custom prompt
gsmart --prompt "Focus on the security implications of these changes"

# Run non-interactively (auto-stage + commit if possible)
gsmart --yes

# Preview staged files without committing
gsmart --dry-run

# Enable debug logging for troubleshooting
gsmart --debug

# Show help
gsmart --help
```

### Configuration

```bash
# Open the interactive configuration menu
gsmart config

# Set a default prompt that will be used on every run
gsmart config --add-custom-prompt "Always use imperative mood and mention the ticket number"

# Show the current default prompt
gsmart config --show

# Clear the default prompt
gsmart config --clear-custom-prompt
```

When `--yes` is set, GSmart stages all detected changes—including renames—and skips interactive prompts so you can automate message generation.

## ⚙️ Configuration

### Environment Variables

| Variable         | Description                        | Default |
| ---------------- | ---------------------------------- | ------- |
| `GSMART_TIMEOUT` | AI request timeout in milliseconds | `30000` |

```bash
# Set a custom timeout (e.g., 60 seconds)
GSMART_TIMEOUT=60000 gsmart
```

If a request exceeds the timeout, GSmart exits cleanly with a user-friendly error message instead of hanging indefinitely.

## 📋 Command Reference

```bash
Usage: gsmart [options] [command]

CLI to generate smart commit messages using AI. generate command is the default command.

Options:
  -V, --version                    Output the version number
  -D, --debug                      Enable debug logging and timing
  -h, --help                       Display help for command

Commands:
  generate [options]               Generate a commit message based on staged changes (default)
    -P, --provider <provider>      Use a specific AI provider
    -p, --prompt <prompt>          Custom prompt for the AI model
    -y, --yes                      Run non-interactively (auto stage + commit)
    -d, --dry-run                  Preview staged files without committing

  login                            Configure AI provider and API key
  reset [options]                  Reset all API keys and configuration
    -f, --force                    Force reset without confirmation prompt

  config [options]                 Manage gsmart configuration (default prompt, commit style)
    -s, --show                     Show current configuration
    --add-custom-prompt <prompt>   Set the default prompt non-interactively
    --clear-custom-prompt          Clear the default prompt non-interactively

  completions <shell>              Output shell completion script (bash, zsh, or fish)

  help [command]                   Display help for command
```

## 🐚 Shell Completions

GSmart supports tab completions for bash, zsh, and fish. Run the `completions` command and add the output to your shell configuration:

### Bash

Add to your `~/.bashrc`:

```bash
eval "$(gsmart completions bash)"
```

### Zsh

Add to your `~/.zshrc`:

```bash
eval "$(gsmart completions zsh)"
```

### Fish

```bash
gsmart completions fish > ~/.config/fish/completions/gsmart.fish
```

## 🤖 Supported AI Providers

| Provider         | Model                                                                             | Get API Key                                                  |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **OpenAI**       | [GPT-5 Codex](https://platform.openai.com/docs/models/gpt-5-codex)                | [Get Key](https://platform.openai.com/api-keys)              |
| **Anthropic**    | [Claude](https://www.anthropic.com/claude)                                        | [Get Key](https://console.anthropic.com/settings/keys)       |
| **Google**       | [Gemini 2.0 Flash](https://ai.google.dev/gemini-api/docs/models#gemini-2.0-flash) | [Get Key](https://console.cloud.google.com/apis/credentials) |
| **Mistral**      | [Mistral Large](https://mistral.ai/technology/#models)                            | [Get Key](https://console.mistral.ai/api-keys/)              |
| **Fireworks AI** | [FireFunction V1](https://fireworks.ai/models/fireworks/firefunction-v1)          | [Get Key](https://fireworks.ai/api-keys)                     |
| **PlataformIA**  | [Radiance](https://docs.plataformia.com/llm-chat-api)                             | [Get Key](https://console.plataformia.com/api-keys)          |

## 🧩 Skill for AI Agents

Do your AI agents write commits for you? Improve your commit quality with the `write-conventional-commit` skill.

Install it with:

```bash
npx skills add ragnarok22/agent-skills --skill write-conventional-commit
```

Repository: [ragnarok22/agent-skills](https://github.com/ragnarok22/agent-skills)

## 🛠️ Development

### Requirements

- Node.js 20+ with ESM support
- pnpm (recommended) or npm

### Scripts

```bash
# Install dependencies
pnpm install

# Development mode
pnpm run dev

# Build the project
pnpm run build

# Run tests
pnpm test

# Lint code
pnpm run lint

# Format code
pnpm run format
```

### Project Structure

```
src/
├── index.ts            # CLI entry point with Commander.js and signal handling
├── gsmart.ts           # Command registration and wiring
├── definitions.ts      # Shared types and interfaces
├── build-info.ts       # Generated build metadata
├── types/
│   └── conf.d.ts       # Module type declaration for conf
├── commands/           # CLI command implementations
│   ├── main.ts         # Default command for commit message generation
│   ├── login.ts        # API key configuration
│   ├── reset.ts        # Configuration reset
│   ├── config.ts       # Custom prompt configuration (set, get, clear)
│   ├── completions.ts  # Shell completion script generator (bash, zsh, fish)
│   └── index.ts        # Command barrel export
└── utils/              # Reusable helpers
    ├── ai.ts           # AI provider integrations, retry handling, and timeout
    ├── config.ts       # Configuration and API key management
    ├── constants.ts    # Shared constants (defaults, timeouts, retries)
    ├── debug.ts        # Debug logging utilities
    ├── git.ts          # Git operations
    ├── holiday.ts      # Seasonal greeting messages
    ├── index.ts        # File staging, clipboard, and retrieval logic
    ├── prompt-config.ts # Custom prompt persistence
    ├── providers.ts    # AI provider definitions and active-provider filter
    ├── version-check.ts # Update notification via update-notifier
    └── welcome.ts      # First-run welcome with shell completion instructions
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using GSmart! (`gsmart`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 Changelog

See [CHANGELOG.md](CHANGELOG.md) for details about releases and changes.

## 📝 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Contributors

<a href="https://github.com/ragnarok22/gsmart/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ragnarok22/gsmart" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=ragnarok22%2Fgsmart&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ragnarok22/gsmart&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ragnarok22/gsmart&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ragnarok22/gsmart&type=date&legend=top-left" />
 </picture>
</a>

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ragnarok22">@ragnarok22</a></sub>
</p>
