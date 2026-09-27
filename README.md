# GSmart

**Your changes. A clear commit message.**

GSmart turns your Git diff into an AI-generated [Conventional Commit](https://www.conventionalcommits.org/). Review the suggestion, edit it, refine it with feedback, copy it, or commit—all from your terminal.

[![NPM Version](https://img.shields.io/npm/v/gsmart)](https://www.npmjs.com/package/gsmart)
[![Test](https://github.com/ragnarok22/gsmart/actions/workflows/test.yml/badge.svg)](https://github.com/ragnarok22/gsmart/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/ragnarok22/gsmart/graph/badge.svg?token=Bsj62uvl22)](https://codecov.io/gh/ragnarok22/gsmart)
[![NPM Downloads](https://img.shields.io/npm/dm/gsmart)](https://www.npmjs.com/package/gsmart)
[![License: GPL-3.0-only](https://img.shields.io/npm/l/gsmart)](https://github.com/ragnarok22/gsmart/blob/main/LICENSE)

[Quick start](#quick-start) · [Everyday workflows](#everyday-workflows) · [Providers](#providers) · [Configuration](#configuration) · [Documentation](#documentation)

![GSmart banner with Git branching and AI icons](https://repository-images.githubusercontent.com/827045490/756cb1d5-9572-4cc2-be37-0459da007c1a)

- **Keep the final say.** Edit multiline messages, request changes, and restore earlier candidates before committing.
- **Choose your AI.** Use six hosted providers, ChatGPT subscription login, or local models through Ollama and LM Studio.
- **Follow your project's conventions.** Share types, scopes, language, and writing instructions, with compatible commitlint rules imported automatically.
- **Fit your workflow.** Review interactively, generate script-friendly output, or ask for a plan to split mixed changes into coherent commits.

## Quick start

You'll need **Node.js 22.12.0+**, **Git 2.25+**, and a [supported provider](#providers) or [local model](#local-inference-and-custom-endpoints).

### 1. Install

```bash
npm install -g gsmart
```

Prefer another package manager? Use `pnpm add -g gsmart` or `yarn global add gsmart` (Yarn Classic).

### 2. Connect a provider

```bash
gsmart login
```

- **OpenAI:** choose **ChatGPT subscription** to sign in through your browser, or **API key** to paste a key.
- **Other hosted providers:** paste your API key when prompted.
- **Custom / local:** enter an OpenAI-compatible base URL and model ID; leave the key blank for a keyless server.

Credentials are saved locally for future runs. Run `gsmart login` again to add or update a provider.

### 3. Generate and review

Inside your Git repository, stage the changes you want to describe and run GSmart. Replace the example path with a file you've changed:

```bash
git add src/auth.ts
gsmart
```

An example review session:

```text
✔ Message generated

Candidate #1 (generated):
feat(auth): add password reset
? What would you like to do?
❯ Commit
  Edit message
  Regenerate with feedback
  Browse / restore candidates
  Copy message to clipboard
  Do nothing
```

**Nothing staged yet?** Run `gsmart` and choose files in the interactive picker. Already staged part of a file with `git add -p`? GSmart uses only that staged diff.

## Everyday workflows

```bash
# Preview a message and the analyzed files without committing
gsmart --dry-run

# Explain intent that the diff cannot show
gsmart --prompt "This fixes checkout retries after a payment timeout; reference SHOP-142."

# Choose a configured provider and model for this run
gsmart --provider anthropic --model claude-haiku-4-5-20251001

# Generate commit prose in another language
gsmart --language es

# Suggest how to split the existing staged changes into coherent commits
gsmart plan --staged

# Generate from the existing staged diff for a script or editor
gsmart --output message
gsmart --output json
```

Planning is advisory: it suggests messages, file/hunk groupings, and ordering without changing your repository. See the [planning guide](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#plan-coherent-commits-from-mixed-changes) for an example.

### Choose the right staging behavior

An **existing staged diff takes priority** in the interactive, `--dry-run`, and `--yes` workflows:

| Command                   | If nothing is staged                                           | Creates a commit? |
| ------------------------- | -------------------------------------------------------------- | ----------------- |
| `gsmart`                  | Prompts you to select files to stage                           | If you choose it  |
| `gsmart --dry-run`        | Temporarily stages your selection, then attempts to unstage it | No                |
| `gsmart --yes`            | Stages all detected changes                                    | Automatically     |
| `gsmart --output message` | Reports an error; does not stage anything                      | No                |
| `gsmart --output json`    | Returns a JSON error; does not stage anything                  | No                |

Dry runs still call the AI provider. Files selected interactively stay staged if you copy the message or choose **Do nothing**.

For automation, `--output message` and `--output json` are prompt-free and leave Git state untouched. Add `--stage` to explicitly stage **all** changes, including previously unstaged edits, or `--commit` to create a commit. These options cannot be combined with `--yes` or `--dry-run`. See [scripting, stdin, JSON results, and Git hooks](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#scripting-editors-and-hooks).

## Providers

Configure providers with `gsmart login`, then select one with `--provider` or save a default with `gsmart config --default-provider <provider>`.

| Provider       | `--provider` value | Authentication                                                          |
| -------------- | ------------------ | ----------------------------------------------------------------------- |
| OpenAI         | `openai`           | ChatGPT subscription or [API key](https://platform.openai.com/api-keys) |
| Anthropic      | `anthropic`        | [API key](https://console.anthropic.com/settings/keys)                  |
| Google Gemini  | `google`           | [API key](https://aistudio.google.com/apikey)                           |
| Mistral        | `mistral`          | [API key](https://console.mistral.ai/api-keys/)                         |
| Fireworks AI   | `fireworks`        | [API key](https://fireworks.ai/api-keys)                                |
| PlataformIA    | `plataformia`      | [API key](https://console.plataformia.com/api-keys)                     |
| Custom / local | `custom`           | Optional bearer token                                                   |

Model selection is **`--model` → saved provider model → built-in default**. Custom endpoints require a model ID. ChatGPT login and OpenAI API keys have different model access; see [authentication and built-in models](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#providers).

### Local inference and custom endpoints

With [Ollama](https://ollama.com/) installed and its server running:

```bash
ollama pull llama3.2
gsmart config --provider custom \
  --base-url http://localhost:11434/v1 \
  --model llama3.2 --clear-api-key
gsmart config --default-provider custom
gsmart --dry-run
```

Run the last command inside a repository with changes. The `custom` provider uses **OpenAI-compatible Chat Completions**. Supply the base URL, including `/v1` when required, rather than `/chat/completions`. See [LM Studio setup, optional authentication, and compatibility](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#local-inference-and-custom-endpoints).

## Configuration

Use `gsmart config` for the interactive menu, or save preferences directly:

```bash
gsmart config --default-provider anthropic
gsmart config --provider anthropic --model claude-haiku-4-5-20251001
gsmart config --add-custom-prompt "Use imperative mood and directory names as scopes."
gsmart config --show
```

To share conventions with your team, commit a `.gsmartrc.json` at the **Git root**:

```json
{
  "$schema": "https://raw.githubusercontent.com/ragnarok22/gsmart/main/schemas/gsmartrc.schema.json",
  "types": ["feat", "fix", "docs", "refactor", "test", "chore"],
  "headerMaxLength": 72,
  "language": "en",
  "instructions": "Describe observable changes. Explain why when it is not obvious."
}
```

Settings resolve per field: **CLI options → `.gsmartrc.json` → compatible commitlint rules → personal settings → built-in defaults**. Inspect the result with `gsmart config --show-effective`. Credentials live in the user-level store, separate from repository conventions.

See the [configuration reference](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#configuration) for scopes, tickets, breaking changes, history examples, context budgets, and separate profiles.

## How it works

```text
Stage or select changes → Generate → Review → Edit, refine, restore, copy, or commit
```

- **AI input:** the selected provider receives your diff context, branch name, resolved conventions, and custom instructions. Recent commit subjects are included only when history examples are enabled. Large diffs are reduced locally by default; extra AI summarization is opt-in.
- **Review:** GSmart validates message syntax and configured rules. You review whether the message accurately describes the change. Earlier candidates remain available during the session.
- **Git:** before committing, GSmart checks that the staged snapshot still matches the message. Commits use `git commit`, so hooks still run. Pushing is a separate Git step.

See [context controls](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#large-diffs-and-ai-context) to inspect or exclude files from AI context. Exclusions affect what the provider sees, not which files are committed.

## Command reference

| Command                      | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `gsmart`                     | Generate a message and review it                       |
| `gsmart plan --staged`       | Suggest a commit-splitting plan                        |
| `gsmart login`               | Configure provider authentication or a custom endpoint |
| `gsmart config`              | Manage prompts, models, and preferences                |
| `gsmart reset`               | Clear local settings after confirmation                |
| `gsmart completions <shell>` | Print Bash, Zsh, or Fish completions                   |

Run `gsmart --help` or `gsmart <command> --help` for available options. The [full command reference](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#command-reference) lists generation and configuration flags.

## Shell completions

For Bash, add `eval "$(gsmart completions bash)"` to `~/.bashrc`. For Zsh, add `eval "$(gsmart completions zsh)"` to `~/.zshrc` after `compinit` is initialized.

For Fish:

```fish
mkdir -p ~/.config/fish/completions
gsmart completions fish > ~/.config/fish/completions/gsmart.fish
```

Start a new terminal and try `gsmart --<Tab>` or `gsmart --provider <Tab>`. See [completion setup and updating existing scripts](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#shell-completions).

## Troubleshooting

| Problem                                 | First thing to check                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Command not found                       | Confirm the global install succeeded and its executable directory is on `PATH`.       |
| No provider configured or login expired | Run `gsmart login`; inspect preferences with `gsmart config --show`.                  |
| No changes found                        | Run `git status` and stage the changes you want to describe.                          |
| Local model is slow or unreachable      | Start the server, verify the URL/model, and increase `GSMART_TIMEOUT` (milliseconds). |
| Editor closes before edits appear       | Set `VISUAL` or `EDITOR` to a command that waits, such as `code --wait`.              |
| Commit fails                            | Check Git's diagnostic for identity, signing, or hook errors.                         |

For diagnostic output, run `gsmart --debug --dry-run`. More remedies are in the [troubleshooting guide](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#troubleshooting).

To update, use `npm install -g gsmart@latest` or `pnpm add -g gsmart@latest`, then check `gsmart --version`. See the [changelog](https://github.com/ragnarok22/gsmart/blob/main/CHANGELOG.md) for release notes.

## Documentation

| I want to…                                | Read                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Edit, refine, or restore a message        | [Review workflow and editor setup](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#edit-and-refine-a-message)                |
| Split mixed changes into commits          | [Advisory commit planning](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#plan-coherent-commits-from-mixed-changes)         |
| Integrate with scripts, editors, or hooks | [Machine output, JSON schema, and exit codes](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#scripting-editors-and-hooks)   |
| Share team conventions                    | [Repository configuration and commitlint](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#shared-repository-conventions)     |
| Understand a rejected message             | [Message validation](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#message-validation)                                     |
| Tune large-diff handling                  | [Context budgets, exclusions, and summarization](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#large-diffs-and-ai-context) |

## Development

Use Node.js 22.12.0+ and the pnpm version pinned in `package.json`:

```bash
git clone https://github.com/ragnarok22/gsmart.git
cd gsmart
pnpm install --frozen-lockfile
pnpm run prebuild
pnpm exec tsx src/index.ts --help
```

Run `pnpm run check` for lint, typecheck, and tests; `pnpm run format:check` for formatting; and `pnpm run test:coverage` for coverage. The [development guide](https://github.com/ragnarok22/gsmart/blob/main/docs/guide.md#development) covers builds, shell tests, code layout, and model evaluations.

## Community

Bug reports, documentation improvements, and pull requests are welcome. Start with the [contribution guide](https://github.com/ragnarok22/gsmart/blob/main/CONTRIBUTING.md). For behavior-changing PRs, include a short CLI transcript showing the result.

[Report an issue](https://github.com/ragnarok22/gsmart/issues) · [Code of conduct](https://github.com/ragnarok22/gsmart/blob/main/CODE_OF_CONDUCT.md) · [Security policy](https://github.com/ragnarok22/gsmart/blob/main/SECURITY.md)

**Working with AI agents?** The companion [`write-conventional-commit` skill](https://github.com/ragnarok22/agent-skills) gives your coding agent commit-writing guidance:

```bash
npx skills add ragnarok22/agent-skills --skill write-conventional-commit
```

<a href="https://github.com/ragnarok22/gsmart/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ragnarok22/gsmart" alt="GSmart contributors" />
</a>

[Explore GSmart's star history](https://www.star-history.com/ragnarok22/gsmart)

## License

Licensed under the [GNU General Public License v3.0 only](https://github.com/ragnarok22/gsmart/blob/main/LICENSE).

Built with ❤️ by [@ragnarok22](https://github.com/ragnarok22).
