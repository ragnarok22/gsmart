# GSmart

**Your changes. A clear commit message.**

GSmart is a CLI that turns your Git diff into an AI-generated [Conventional Commit](https://www.conventionalcommits.org/). Review the suggestion, edit it, refine it with feedback, copy it, or commit—all from your terminal.

[![NPM Version](https://img.shields.io/npm/v/gsmart)](https://www.npmjs.com/package/gsmart)
[![Test](https://github.com/ragnarok22/gsmart/actions/workflows/test.yml/badge.svg)](https://github.com/ragnarok22/gsmart/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/ragnarok22/gsmart/graph/badge.svg?token=Bsj62uvl22)](https://codecov.io/gh/ragnarok22/gsmart)
[![NPM Downloads](https://img.shields.io/npm/dm/gsmart)](https://www.npmjs.com/package/gsmart)
[![License: GPL-3.0-only](https://img.shields.io/npm/l/gsmart)](https://github.com/ragnarok22/gsmart/blob/main/LICENSE)

[Quick start](#quick-start) · [Everyday workflows](#everyday-workflows) · [Configuration](#configuration) · [Providers](#providers) · [Command reference](#command-reference) · [Troubleshooting](#troubleshooting)

![GSmart banner with Git branching and AI icons](https://repository-images.githubusercontent.com/827045490/756cb1d5-9572-4cc2-be37-0459da007c1a)

- **Start with your actual changes.** Generate a message from your staged diff and branch name, or choose files interactively.
- **Keep the final say.** Review each suggestion before committing, or use `--yes` for a non-interactive workflow.
- **Bring your preferred provider.** Choose from six providers, including OpenAI with ChatGPT subscription login or an API key.
- **Make it sound like your project.** Save writing instructions and add context for individual commits.

> **First visit?** Follow the quick start below. **Already using GSmart?** Jump to the [workflow recipes](#everyday-workflows), [shell completions](#shell-completions), or [release notes](https://github.com/ragnarok22/gsmart/blob/main/CHANGELOG.md).

## Quick start

You'll need **Node.js 22+**, **Git**, and an account with one of the [supported providers](#providers). Run GSmart inside the Git repository you're working on.

### 1. Install

Choose your package manager:

```bash
npm install -g gsmart
```

```bash
pnpm add -g gsmart
```

<details>
<summary>Using Yarn Classic?</summary>

```bash
yarn global add gsmart
```

</details>

### 2. Connect a provider

```bash
gsmart login
```

Select a provider, then follow its sign-in flow:

- **OpenAI:** choose **ChatGPT subscription** to authorize in your browser, or **API key** to paste a key.
- **Other providers:** paste an API key when prompted. See the [provider table](#providers) for links.

Credentials are saved locally for future runs. You can run `gsmart login` again to add another provider or update your authentication.

### 3. Generate and review

Stage the changes you want to describe, then run GSmart. Replace the example path with a file you've changed:

```bash
git add src/auth.ts
gsmart
```

A typical interaction looks like this; the generated message depends on your changes:

```text
$ gsmart
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

| Action                      | What happens                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Commit                      | Checks staged content, then creates a local Git commit using the selected message.       |
| Edit message                | Opens the subject and multiline body in your editor, then returns to review.             |
| Regenerate with feedback    | Uses your feedback and current candidate to request a revised message.                   |
| Browse / restore candidates | Compares complete messages and restores an earlier candidate without another AI request. |
| Copy message to clipboard   | Copies the message so you can use or edit it elsewhere.                                  |
| Do nothing                  | Ends the run, leaving your changes available for later.                                  |

**Nothing staged yet?** Run `gsmart` and use the file picker to choose what to stage. If you have multiple providers configured, you'll also be asked which one to use.

## How it works

```text
Stage or select changes → Generate a message → Review → Edit, refine, restore, copy, or commit
```

1. **Read the changes.** GSmart uses your staged diff—the changes Git is ready to commit. If that diff is empty, it offers to stage files for you.
2. **Ask your provider.** It sends the diff, current branch name, and any custom instructions to the selected AI provider.
3. **Choose the next step.** You review the message before committing. Commits use `git commit`, so your Git hooks still run; pushing remains a separate Git step.

Already staged part of a file with `git add -p`? GSmart uses that staged diff. Other unstaged edits are left out. Files staged through the interactive picker stay staged if you choose **Copy** or **Do nothing**.

### A quick guide to Conventional Commits

The format makes a project's history easier to scan:

```text
feat(auth): add password reset
│    │     └─ Short description of the change
│    └─────── Optional scope: the area affected
└──────────── Type: the kind of change
```

Common types include `feat` for new functionality, `fix` for a bug fix, `docs` for documentation, and `refactor` for restructuring code without changing its behavior. GSmart asks the model to follow this format; review the suggestion for accuracy before committing.

**For better suggestions:** stage one logical change at a time and use a [custom prompt](#configuration) to explain context the diff cannot show.

## Everyday workflows

### Edit and refine a message

Choose **Edit message** to change the subject and multiline body in an external editor. The first line is the subject; separate the body with a blank line. Save and close the file to return to review, then select **Commit** when satisfied.

Choose **Regenerate with feedback** for targeted changes such as “shorter”, “mention the migration”, or “this fixes a bug”. Submit blank feedback for another version. Refinement reuses the selected provider, captured branch and diff, custom instructions, and current candidate—including manual edits.

Example review session:

```text
Candidate #1 (generated):
feat(db): add accounts migration and initialize account records
? What would you like to do? › Regenerate with feedback
? What should change? › shorter; mention the migration
✔ Message generated

Candidate #2 (refined):
feat(db): add accounts migration
? What would you like to do? › Edit message

Candidate #3 (edited):
feat(db): add accounts migration

Preserve existing account IDs during migration.
? What would you like to do? › Commit
✔ Changes committed successfully
```

**Browse / restore candidates** previews complete messages alongside the current candidate. Confirm **Restore** to select one without another AI request. History includes generated, edited, and refined messages and lasts for the current invocation only. Editing, refining, and restoring always return to review.

Press **Esc** to cancel feedback or candidate browsing. Press **Ctrl+C** during a refinement request to cancel it and return to the current candidate. Errors and canceled operations preserve the current candidate and never create a commit.

#### Configure your editor

GSmart uses the first non-empty setting in `$VISUAL`, then `$EDITOR`. If neither is set, it uses `vi` on macOS/Linux or `notepad` on Windows. Editor arguments and quoted executable paths are supported. Configure GUI editors to wait until you close the message file:

```bash
# VS Code (Bash/Zsh)
export VISUAL="code --wait"

# Or use a terminal editor
export EDITOR="nano"
```

```powershell
# VS Code (Windows PowerShell)
$env:VISUAL = "code --wait"
```

To cancel editing, quit the editor without saving (for example, `:q!` in `vi`); an unchanged file leaves the current candidate selected. If you already saved changes, restore the earlier candidate from history. Empty messages and editor failures keep the current candidate and display an error so you can retry. Temporary editor files are cleaned up afterward.

#### If staged content changes during review

Before committing, GSmart checks the staged content and its Git base again. If they have changed, it marks the candidate as outdated and offers to generate a fresh message using the same provider. Review that message and select **Commit** again. Earlier candidates remain available for comparison or copying; restoring or editing one does not bypass this check. Declining or canceling the refresh keeps the current candidate.

### Choose a provider for this run

After configuring it with `gsmart login`:

```bash
gsmart --provider anthropic
```

Use the exact identifier from the [provider table](#providers). This selects a provider for the current run without saving a default.

### Preview before committing

Generate a message and list the files in the analyzed diff:

```bash
gsmart --dry-run
```

Dry run still needs authentication and makes an AI request. It skips committing and the final action menu. If nothing is staged, GSmart temporarily stages your selected files to read their diff, then attempts to unstage them. Existing staged changes stay staged.

### Skip the generation prompts

Use `--yes` when you're ready to generate and commit in one step:

```bash
gsmart --yes --provider openai
```

Login must already be configured. Specifying a provider makes the choice explicit; otherwise, GSmart uses the first configured provider in the [table's order](#providers).

`--yes` skips message review and editing. If staged content changes before its commit or cannot be verified, it stops with exit status `1` and asks you to rerun GSmart.

| Command                  | If a staged diff exists | If nothing is staged                          | Creates a commit? |
| ------------------------ | ----------------------- | --------------------------------------------- | ----------------- |
| `gsmart`                 | Uses it                 | Prompts you to select files to stage          | If you choose it  |
| `gsmart --dry-run`       | Uses it                 | Prompts, temporarily stages, then unstages    | No                |
| `gsmart --yes`           | Uses it                 | Stages all detected changes                   | Automatically     |
| `gsmart --yes --dry-run` | Uses it                 | Temporarily stages all changes, then unstages | No                |

**The staging rule:** an existing staged diff always takes priority. `--yes` only auto-stages all detected changes when that diff is empty. Dry-run cleanup reports a warning if files could not be unstaged.

### Give one commit extra context

Explain the intent behind a change:

```bash
gsmart --prompt "This fixes checkout retries after a payment timeout; reference SHOP-142."
```

This replaces your saved custom instructions for this run. To reuse a style across commits, [save a default prompt](#configuration).

### Stay up to date

Use the package manager you installed with:

```bash
# npm
npm install -g gsmart@latest

# pnpm
pnpm add -g gsmart@latest
```

Check your installation with `gsmart --version`. The [changelog](https://github.com/ragnarok22/gsmart/blob/main/CHANGELOG.md) covers new features, model updates, fixes, and runtime requirement changes.

## Configuration

### Save your preferred commit style

Use `gsmart config` for the interactive menu, or set instructions directly:

```bash
gsmart config --add-custom-prompt "Use imperative mood, keep the subject concise, and use directory names as scopes."

# Read your saved prompt
gsmart config --show

# Clear it and return to the built-in instructions
gsmart config --clear-custom-prompt
```

Custom instructions are selected in this order:

1. A nonempty `--prompt` for the current run.
2. Your saved default prompt, if there is no one-off prompt.
3. Built-in instructions alone, if neither is set.

The selected custom instructions are added to GSmart's built-in Conventional Commits instructions. A one-off prompt replaces the saved custom prompt rather than combining with it. `config --show` displays the saved prompt, not credentials.

### Environment variables

| Variable            | Purpose                                        | Default                                   |
| ------------------- | ---------------------------------------------- | ----------------------------------------- |
| `GSMART_TIMEOUT`    | Timeout per AI generation attempt, in ms       | `30000` (30 seconds)                      |
| `GSMART_CONFIG_DIR` | Directory for GSmart's local configuration     | Your OS's user configuration location     |
| `VISUAL`            | Preferred editor command for message editing   | Unset                                     |
| `EDITOR`            | Editor command when `VISUAL` is unset or blank | `vi` on macOS/Linux; `notepad` on Windows |

For example, allow up to 60 seconds per generation attempt in Bash or Zsh:

```bash
GSMART_TIMEOUT=60000 gsmart
```

Invalid or nonpositive timeout values fall back to 30 seconds. GSmart retries transient failures, including network errors, rate limits, and server errors, so a complete run can take longer than one timeout period.

<details>
<summary><strong>Where settings live, separate configurations, and resetting</strong></summary>

GSmart stores API keys, ChatGPT login tokens, and your default prompt in a local, user-level configuration file managed by `conf`. These settings are shared across repositories when you use the same configuration directory.

To keep a separate configuration, set `GSMART_CONFIG_DIR` consistently for login and generation. For example, in Bash or Zsh:

```bash
export GSMART_CONFIG_DIR="$HOME/.config/gsmart-work"
gsmart login
gsmart
```

To clear the active configuration:

```bash
gsmart reset
```

This asks for confirmation, then clears all settings in that configuration store, including provider credentials, ChatGPT login tokens, and the saved prompt. `gsmart reset --force` skips the confirmation. Resetting clears local settings; credential revocation is managed through your provider.

</details>

## Providers

Run `gsmart login` to configure any of these providers:

| Provider      | `--provider` value | Authentication                                                                |
| ------------- | ------------------ | ----------------------------------------------------------------------------- |
| OpenAI        | `openai`           | ChatGPT subscription login or [API key](https://platform.openai.com/api-keys) |
| Anthropic     | `anthropic`        | [API key](https://console.anthropic.com/settings/keys)                        |
| Google Gemini | `google`           | [API key](https://aistudio.google.com/apikey)                                 |
| Mistral       | `mistral`          | [API key](https://console.mistral.ai/api-keys/)                               |
| Fireworks AI  | `fireworks`        | [API key](https://fireworks.ai/api-keys)                                      |
| PlataformIA   | `plataformia`      | [API key](https://console.plataformia.com/api-keys)                           |

With one configured provider, GSmart selects it automatically. With several, it offers a chooser. `--provider` selects one explicitly; `--yes` uses the first configured entry in the order above.

**Using ChatGPT?** Choose **OpenAI → ChatGPT subscription** during login. GSmart prints an authorization URL and attempts to open it in your browser. Complete authorization on the machine running the CLI so the local callback can finish. Tokens refresh automatically; if the login expires, run `gsmart login` again.

<details>
<summary><strong>Which models does GSmart use?</strong></summary>

Models are selected by GSmart's provider integration. The current model IDs are:

| Provider     | Model ID                                      |
| ------------ | --------------------------------------------- |
| OpenAI       | `gpt-5.6-luna`                                |
| Anthropic    | `claude-haiku-4-5-20251001`                   |
| Google       | `gemini-3.5-flash-lite`                       |
| Mistral      | `mistral-large-latest`                        |
| Fireworks AI | `accounts/fireworks/models/deepseek-v4-flash` |
| PlataformIA  | `radiance`                                    |

Model selection is built into the application rather than exposed as a CLI option. Availability depends on your provider account. See the [provider implementation](https://github.com/ragnarok22/gsmart/blob/main/src/utils/ai.ts) and [changelog](https://github.com/ragnarok22/gsmart/blob/main/CHANGELOG.md) for updates.

</details>

## Command reference

`gsmart` is shorthand for `gsmart generate`. Use `gsmart --help` for the command list or `gsmart generate --help` for generation options.

| Command                      | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `gsmart` / `gsmart generate` | Generate a message and choose what to do with it        |
| `gsmart login`               | Configure a provider's authentication                   |
| `gsmart config`              | Set, show, or clear your default writing instructions   |
| `gsmart reset`               | Clear the active local configuration after confirmation |
| `gsmart completions <shell>` | Print a completion script for `bash`, `zsh`, or `fish`  |
| `gsmart help [command]`      | Show help for a command                                 |

**Generation options** — use with `gsmart` or `gsmart generate`:

| Option                  | Short | Purpose                                                       |
| ----------------------- | ----- | ------------------------------------------------------------- |
| `--provider <provider>` | `-P`  | Choose an already-configured provider                         |
| `--prompt <prompt>`     | `-p`  | Supply custom instructions for this run                       |
| `--yes`                 | `-y`  | Skip generation prompts and commit automatically              |
| `--dry-run`             | `-d`  | Generate a message and show analyzed files without committing |

**Other options:**

| Command and option                         | Short | Purpose                                   |
| ------------------------------------------ | ----- | ----------------------------------------- |
| `gsmart --debug`                           | `-D`  | Enable diagnostic logging and timing      |
| `gsmart --version`                         | `-V`  | Print the installed version               |
| `gsmart --help`                            | `-h`  | Show help; also available on subcommands  |
| `gsmart config --show`                     | `-s`  | Display the saved default prompt          |
| `gsmart config --add-custom-prompt <text>` |       | Save default writing instructions         |
| `gsmart config --clear-custom-prompt`      |       | Clear default writing instructions        |
| `gsmart reset --force`                     | `-f`  | Reset local settings without confirmation |

## Troubleshooting

| What you see                             | What to try                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `gsmart: command not found`              | Confirm the global installation completed and your package manager's global executable directory is on `PATH`.                   |
| No changes found                         | Run `git status` in the repository and check that you have changes to describe.                                                  |
| No API keys / no valid provider          | Run `gsmart login`. If you passed `--provider`, use a configured identifier from the provider table.                             |
| Invalid API key or expired ChatGPT login | Run `gsmart login` again to update the key or repeat browser authorization.                                                      |
| Request timed out / could not reach API  | Check connectivity; for slow responses, increase `GSMART_TIMEOUT`.                                                               |
| Rate limited / model unavailable         | Wait before retrying a rate limit. For an unavailable model, check account access or select another configured provider.         |
| Failed to commit changes                 | Check your Git identity, repository state, and hook output. GSmart attempts to copy the message to your clipboard as a fallback. |
| Could not copy message to clipboard      | Copy the printed message directly from the terminal.                                                                             |
| Failed to unstage files after dry-run    | Run `git status` to inspect the index and unstage the files you intended only to preview.                                        |
| Editor failed or edits did not appear    | Check `VISUAL` / `EDITOR` and add a wait flag for GUI editors, such as `code --wait`, then retry **Edit message**.               |
| Staged content has changed               | Regenerate for the updated changes, review the new message, then choose **Commit** again.                                        |

For more detail, combine debug logging with a preview:

```bash
gsmart --debug --dry-run
```

Still stuck? [Open an issue](https://github.com/ragnarok22/gsmart/issues) with your GSmart version, Node.js version, provider, command, and relevant output.

## Shell completions

Enable tab completion for your shell, then start a new terminal session.

<details>
<summary><strong>Bash</strong> — add to <code>~/.bashrc</code></summary>

```bash
eval "$(gsmart completions bash)"
```

</details>

<details>
<summary><strong>Zsh</strong> — add to <code>~/.zshrc</code></summary>

Initialize Zsh's completion system first if your shell configuration doesn't already do so:

```zsh
autoload -Uz compinit
compinit
eval "$(gsmart completions zsh)"
```

</details>

<details>
<summary><strong>Fish</strong> — save a completion file</summary>

```fish
mkdir -p ~/.config/fish/completions
gsmart completions fish > ~/.config/fish/completions/gsmart.fish
```

</details>

## Development

Use **Node.js 22+** (`.nvmrc` pins the development version) and the **pnpm version pinned in `package.json`**.

```bash
git clone https://github.com/ragnarok22/gsmart.git
cd gsmart
pnpm install --frozen-lockfile
pnpm run prebuild

# Run the CLI from source
pnpm exec tsx src/index.ts --help
pnpm exec tsx src/index.ts login
pnpm exec tsx src/index.ts --dry-run
```

`prebuild` generates the build metadata needed by source execution. Use `pnpm exec tsx src/index.ts login` for local GSmart authentication; `pnpm login` and `npm login` authenticate with the package registry.

<details>
<summary><strong>Build, checks, and coverage</strong></summary>

```bash
# Build the CLI, then run the bundle
pnpm run build
node dist/index.js --help

# Watch and rebuild the bundle as you edit
pnpm run dev

# Lint, typecheck, and run tests
pnpm run check

# Check formatting separately
pnpm run format:check

# Run tests and generate coverage/lcov.info
mkdir -p coverage
pnpm run test:coverage
```

`pnpm run dev` watches the bundle; run the CLI in another terminal to try your changes. Build and typecheck run the metadata-generation hook automatically. Coverage runs the full suite first, then instruments a selected set of tests.

</details>

<details>
<summary><strong>Find your way around the code</strong></summary>

| Location                    | Responsibility                                           |
| --------------------------- | -------------------------------------------------------- |
| `src/index.ts`              | Commander CLI setup, options, and signal handling        |
| `src/gsmart.ts`             | Command registration                                     |
| `src/commands/`             | Generation, login, configuration, reset, and completions |
| `src/utils/ai.ts`           | Provider models, prompts, timeouts, and retries          |
| `src/utils/openai-oauth.ts` | ChatGPT browser login and token refresh                  |
| `src/utils/git.ts`          | Git operations and diff parsing                          |
| `src/utils/editor.ts`       | External message editing and temporary-file cleanup      |
| `src/utils/interrupt.ts`    | Foreground operation cancellation                        |
| `src/utils/index.ts`        | File selection, staging, and clipboard helpers           |
| `src/utils/config.ts`       | Local credentials and settings                           |
| `src/definitions.ts`        | Shared TypeScript contracts                              |
| `test/`                     | Unit and integration tests                               |

`src/build-info.ts` and `dist/` are generated. See [AGENTS.md](https://github.com/ragnarok22/gsmart/blob/main/AGENTS.md) for implementation conventions and focused test commands.

</details>

## Community

### Contribute

Bug reports, documentation improvements, and pull requests are welcome. Start with the [contribution guide](https://github.com/ragnarok22/gsmart/blob/main/CONTRIBUTING.md), create a branch from `main`, and run the development checks above before opening a PR. For behavior changes, include a short CLI transcript showing the result.

[Report an issue](https://github.com/ragnarok22/gsmart/issues) · [Code of conduct](https://github.com/ragnarok22/gsmart/blob/main/CODE_OF_CONDUCT.md) · [Security policy](https://github.com/ragnarok22/gsmart/blob/main/SECURITY.md) · [Changelog](https://github.com/ragnarok22/gsmart/blob/main/CHANGELOG.md)

### Working with AI agents?

The companion [`write-conventional-commit` skill](https://github.com/ragnarok22/agent-skills) gives your coding agent commit-writing guidance:

```bash
npx skills add ragnarok22/agent-skills --skill write-conventional-commit
```

### Contributors

<a href="https://github.com/ragnarok22/gsmart/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ragnarok22/gsmart" alt="GSmart contributors" />
</a>

<details>
<summary><strong>Star history</strong></summary>

<p align="center">
  <a href="https://www.star-history.com/ragnarok22/gsmart">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ragnarok22/gsmart&type=date&theme=dark&legend=top-left" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ragnarok22/gsmart&type=date&legend=top-left" />
      <img alt="GSmart star history chart" src="https://api.star-history.com/chart?repos=ragnarok22/gsmart&type=date&legend=top-left" />
    </picture>
  </a>
</p>

[Explore GSmart's star history](https://www.star-history.com/ragnarok22/gsmart)

</details>

## License

Licensed under the [GNU General Public License v3.0 only](https://github.com/ragnarok22/gsmart/blob/main/LICENSE).

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ragnarok22">@ragnarok22</a></sub>
</p>
