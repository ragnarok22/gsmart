> **The smart way to write your commit messages using AI** 🤖

GSmart is a CLI tool that automatically generates [Conventional Commits](https://www.conventionalcommits.org/) by analyzing your staged git changes. Simply stage your files and let AI craft the perfect commit message for you.

[![Test](https://github.com/ragnarok22/gsmart/actions/workflows/test.yml/badge.svg)](https://github.com/ragnarok22/gsmart/actions)
[![codecov](https://codecov.io/gh/ragnarok22/gsmart/branch/main/graph/badge.svg)](https://codecov.io/gh/ragnarok22/gsmart)
[![NPM Downloads](https://img.shields.io/npm/dm/gsmart)](https://www.npmjs.com/package/gsmart)
[![NPM Version](https://img.shields.io/npm/v/gsmart)](https://www.npmjs.com/package/gsmart)
[![NPM License](https://img.shields.io/npm/l/gsmart)](https://github.com/ragnarok22/gsmart/blob/main/LICENSE)

![GSmart Demo](https://repository-images.githubusercontent.com/827045490/756cb1d5-9572-4cc2-be37-0459da007c1a)

## ✨ Features

- 🎯 **Smart Commit Messages**: AI-generated conventional commits based on your changes
- 🔄 **Multiple AI Providers**: Support for OpenAI, Anthropic, Google, Mistral, Fireworks AI, and PlataformIA
- 📋 **Interactive CLI**: Easy-to-use command line interface with interactive prompts
- 🧠 **Rename-Aware Staging**: Detects renames and copies so both sides get staged automatically
- 🔒 **Secure**: API keys stored locally and securely
- ⚡ **Fast**: Quick analysis and generation of commit messages
- 📖 **Conventional Commits**: Follows industry-standard commit message format

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

# Show help
gsmart --help
```

When `--yes` is set, GSmart stages all detected changes—including renames—and skips interactive prompts so you can automate message generation.

## 📋 Command Reference

```bash
Usage: gsmart [options] [command]

CLI to generate smart commit messages using AI. generate command is the default command.

Options:
  -V, --version                    Output the version number
  -h, --help                       Display help for command

Commands:
  generate [options]               Generate a commit message based on staged changes (default)
    --provider <provider>          Use a specific AI provider
    --prompt <prompt>              Custom prompt for the AI model
    --yes                         Run non-interactively (auto stage + commit)

  login                           Configure AI provider and API key
  reset                           Reset all API keys and configuration
  help [command]                  Display help for command
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
├── commands/          # CLI command implementations
├── utils/
│   ├── ai.ts         # AI provider integrations
│   ├── git.ts        # Git operations
│   └── config.ts     # Configuration management
├── gsmart.ts         # Command registration
└── index.ts          # CLI entry point
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

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ragnarok22">@ragnarok22</a></sub>
</p>
