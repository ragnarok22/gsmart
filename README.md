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
- **Bring your preferred provider and model.** Save defaults for six hosted providers, or connect a local OpenAI-compatible endpoint such as Ollama or LM Studio. OpenAI supports ChatGPT subscription login and API keys.
- **Make it sound like your project.** Share repository conventions, save personal writing instructions, and add context for individual commits.

> **First visit?** Follow the quick start below. **Already using GSmart?** Jump to the [workflow recipes](#everyday-workflows), [shell completions](#shell-completions), or [release notes](https://github.com/ragnarok22/gsmart/blob/main/CHANGELOG.md).

## Quick start

You'll need **Node.js 22.12.0+**, **Git**, and either an account with one of the [supported providers](#providers) or a [local inference server](#local-inference-and-custom-endpoints). Run GSmart inside the Git repository you're working on.

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
- **Other hosted providers:** paste an API key when prompted. See the [provider table](#providers) for links.
- **Custom (OpenAI-compatible):** enter your API base URL and model ID. Leave the key blank for a keyless local server.

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

**Nothing staged yet?** Run `gsmart` and use the file picker to choose what to stage. If you have multiple providers configured and no saved default or explicit `--provider`, you'll also be asked which one to use.

## How it works

```text
Stage or select changes → Generate a message → Review → Edit, refine, restore, copy, or commit
```

1. **Read the changes.** GSmart uses your staged diff—the changes Git is ready to commit. If that diff is empty, it offers to stage files for you.
2. **Ask your provider.** It sends the diff, current branch name, resolved commit conventions, and any custom instructions to the selected AI provider. Recent commit subjects are also sent when you enable history examples.
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

Choose **Regenerate with feedback** for targeted changes such as “shorter”, “mention the migration”, or “this fixes a bug”. Submit blank feedback for another version. Refinement reuses the selected provider and model, captured branch and diff, custom instructions, and current candidate—including manual edits.

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

**SIGTERM** requests shutdown instead of returning to review. GSmart cancels the active editor or refinement operation, finishes cleanup, and exits.

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
gsmart --provider anthropic --model claude-haiku-4-5-20251001
```

Use the exact identifier from the [provider table](#providers). These options select a provider and model for the current run without changing saved preferences. See [provider and model defaults](#provider-and-model-defaults) to make the choice persistent.

### Preview before committing

Generate a message and list the files in the analyzed diff:

```bash
gsmart --dry-run
```

Dry run still makes an AI request and needs a configured provider (authentication is optional for custom endpoints). It skips committing and the final action menu. If nothing is staged, GSmart temporarily stages your selected files to read their diff, then attempts to unstage them. Existing staged changes stay staged.

### Skip the generation prompts

Use `--yes` when you're ready to generate and commit in one step:

```bash
gsmart --yes --provider openai
```

A hosted login or custom endpoint must already be configured. GSmart uses an explicit `--provider`, then your saved default provider, then the first configured provider in the [table's order](#providers).

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

This replaces repository or saved personal custom instructions for this run. Structured conventions such as allowed types and length limits still apply. To reuse a style across commits, [configure repository conventions or save a default prompt](#configuration).

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

### Provider and model defaults

Use the `gsmart config` menu to save a default provider, choose a model, or configure a custom endpoint. The equivalent flags work without interactive prompts:

```bash
gsmart config --default-provider anthropic
gsmart config --provider anthropic --model claude-haiku-4-5-20251001
gsmart config --show

# One invocation; does not change the saved settings
gsmart --provider openai --model gpt-5-codex --dry-run

# Return to automatic provider selection or a built-in model
gsmart config --clear-default-provider
gsmart config --provider anthropic --clear-model
```

Provider and prompt settings can be updated together. Add `--show` to inspect the saved result:

```bash
gsmart config --default-provider anthropic --add-custom-prompt "Use Spanish" --show
```

In the **Set preferred model** menu, the current model is displayed for reference. Submit blank input to clear it, or press Esc to keep it.

Selection precedence is:

| Setting  | First choice          | Second choice                         | Fallback                                                                                                   |
| -------- | --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Provider | Explicit `--provider` | Saved default provider                | One configured provider automatically; a chooser if several exist; first configured provider under `--yes` |
| Model    | Explicit `--model`    | Saved model for the selected provider | [Built-in model](#which-models-does-gsmart-use), with a separate ChatGPT OAuth fallback                    |

An explicit or saved provider must be configured; GSmart reports setup instructions rather than silently choosing another provider. A `custom` endpoint is configured when it has a valid base URL and a saved model (or a `--model` override). It does not need a hosted-provider login. Custom endpoints have no built-in model because model IDs depend on the server.

Model IDs are trimmed and must be nonempty. Availability is checked by the provider during generation, so new or private models do not need to be added to GSmart's source code. `--model` does not change the API operation or authentication mode. Provider and model selection remain the same during refinement and staged-change regeneration.

### Local inference and custom endpoints

The `custom` provider uses **OpenAI-compatible Chat Completions** (`POST <base-url>/chat/completions`). Configure the base URL, including `/v1` when required, rather than the full operation URL. You can save one custom endpoint per configuration directory; use `GSMART_CONFIG_DIR` for separate profiles.

#### Ollama

Install [Ollama](https://ollama.com/), start its server (`ollama serve`, or the desktop app), and download a model. With the server running:

```bash
ollama pull llama3.2
gsmart config --provider custom \
  --base-url http://localhost:11434/v1 \
  --model llama3.2 --clear-api-key
gsmart config --default-provider custom

# Run inside a Git repository with staged changes
gsmart --dry-run
```

The local Ollama server does not require a key. Use the exact installed model ID, including its tag. Ollama's native `/api/chat` endpoint is not the OpenAI-compatible URL. See [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility).

#### LM Studio

Download and load a text-generation model in [LM Studio](https://lmstudio.ai/), then start the server from its Developer tab. With the default port and authentication disabled:

```bash
# Find the model identifier returned by your server
curl http://localhost:1234/v1/models

# Replace MODEL_ID with that identifier
gsmart config --provider custom \
  --base-url http://localhost:1234/v1 \
  --model MODEL_ID --clear-api-key
gsmart config --default-provider custom
gsmart --dry-run
```

See [LM Studio's OpenAI-compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat). If server authentication is enabled, configure its token instead of `--clear-api-key`.

#### Optional authentication and compatibility

```bash
# Set the custom server's bearer token; hosted keys are configured through login
gsmart config --provider custom --api-key YOUR_ENDPOINT_KEY

# Remove authentication; requests will contain no Authorization header
gsmart config --provider custom --clear-api-key

# Remove the URL, model, key, and default-provider selection if it points to custom
gsmart config --clear-custom-endpoint
```

You can also choose **Custom (OpenAI-compatible)** in `gsmart login`, or **Configure custom / local endpoint** in `gsmart config`, to enter the key through a password prompt. A blank key clears any previous custom key. Custom keys have no hosted-provider prefix or minimum-length requirement. Custom requests use only the custom key; they never inherit OpenAI API keys or ChatGPT tokens.

The server must accept text system/user messages and return a standard Chat Completions response. GSmart's custom integration does not use the Responses API, native Ollama/LM Studio APIs, legacy text completions, or automatic protocol detection. A Responses-only model needs a provider/API integration that supports it. Local models must be downloaded/loaded separately and have enough context for the diff and instructions. Model quality, context limits, and hardware determine results and latency; increase `GSMART_TIMEOUT` for slow inference.

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
2. The repository's `instructions` setting, if present in `.gsmartrc.json`.
3. Your saved default prompt.
4. Built-in instructions alone.

The selected text is added to the resolved Conventional Commits instructions. These custom-instruction sources replace each other rather than concatenate. Repository `"instructions": ""` explicitly clears inherited personal instructions. `config --show` displays the saved personal prompt and provider/model preferences, with authentication status but no credential values.

### Shared repository conventions

Create and commit `.gsmartrc.json` at your **Git root**. GSmart uses that same file from the root or any nested directory, including in Git worktrees. Nested `.gsmartrc.json` files do not override the root file.

```json
{
  "$schema": "https://raw.githubusercontent.com/ragnarok22/gsmart/main/schemas/gsmartrc.schema.json",
  "types": ["feat", "fix", "docs", "refactor", "test", "chore"],
  "scopes": ["cli", "utils", "deps"],
  "scope": "optional",
  "headerMaxLength": 72,
  "subjectMaxLength": 60,
  "language": "en",
  "tickets": {
    "prefixes": ["APP-"],
    "required": false,
    "placement": "footer",
    "footerToken": "Refs"
  },
  "body": {
    "presence": "optional",
    "maxLineLength": 100,
    "instructions": "Explain why the change is needed when it is not obvious."
  },
  "breakingChanges": {
    "requireFooter": true,
    "instructions": "Describe the impact and any migration steps."
  },
  "instructions": "Use imperative mood and describe observable changes.",
  "commitlint": true,
  "history": { "enabled": false, "limit": 5 }
}
```

The [JSON Schema](schemas/gsmartrc.schema.json) is included in the npm package as `gsmart/schemas/gsmartrc.schema.json`. Use the `$schema` URL for editor support; runtime validation uses the bundled schema without a network request. All settings are optional. Unknown properties, malformed JSON, and invalid values stop generation with the config path and setting to correct, before file selection or auto-staging.

| Setting               | Meaning and default                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types`               | Allowed types; defaults to `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. `null` allows any Conventional Commit type.                                                                                                                                 |
| `scopes`              | Allowed scopes, or `null` for unrestricted scopes (default). For multiple scopes separated by `/`, `\` or `,`, each component must be allowed.                                                                                                                                                       |
| `scope`               | `optional` (default), `required`, or `forbidden`.                                                                                                                                                                                                                                                    |
| `headerMaxLength`     | Maximum length of the entire first line, including type and scope. Positive integer or `null` (default: no limit).                                                                                                                                                                                   |
| `subjectMaxLength`    | Maximum length of the description **after** `type(scope): `. Positive integer or `null` (default: no limit).                                                                                                                                                                                         |
| `language`            | Output language tag, such as `en` (default), `es`, or `pt-BR`. Type tokens, scopes, ticket IDs and footer labels retain their configured spelling.                                                                                                                                                   |
| `tickets`             | `prefixes` (default `null`, unrestricted), `required` (default `false`), `placement` (`subject`, `body`, or default `footer`), and `footerToken` (default `Refs`). Configured prefixes are followed by numeric IDs. Supply IDs in the branch, changes, or prompt; historical IDs must not be reused. |
| `body`                | `presence` (`optional`, `required`, `forbidden`), `leadingBlank` (default `true`), `maxLineLength` (default `null`; URL-containing lines are exempt), and optional `instructions`.                                                                                                                   |
| `footer.leadingBlank` | Separate footers from preceding content with a blank line (default `true`).                                                                                                                                                                                                                          |
| `breakingChanges`     | `requireFooter` (default `false`) requires a `BREAKING CHANGE:` footer for breaking changes even with a `!` header; `instructions` supplies migration/impact guidance.                                                                                                                               |
| `instructions`        | Additional generation instructions, up to 10,000 characters. Body and breaking-change instructions have the same limit.                                                                                                                                                                              |
| `commitlint`          | Import compatible rules from a root commitlint configuration (default `true`). Set to `false` to skip discovery and loading.                                                                                                                                                                         |
| `history`             | `enabled` (default `false`) and `limit` (1–20, default `5`).                                                                                                                                                                                                                                         |
| `context`             | Request budgets, context exclusions, generated-file patterns, and opt-in AI summarization. See [Large diffs and AI context](#large-diffs-and-ai-context).                                                                                                                                            |

Configuration is merged **per setting**, from highest to lowest priority:

1. Explicit CLI options (`--prompt`, `--language`, `--history-examples`, and context overrides).
2. `.gsmartrc.json` settings.
3. Compatible rules imported from the repository's commitlint configuration.
4. User settings (currently the saved default prompt).
5. Built-in defaults.

Nested objects merge by individual field; arrays replace rather than concatenate. Explicit `false`, `null` where allowed, and empty instruction strings override inherited values. CLI options override their corresponding settings, not the entire repository configuration. Structured conventions take precedence over conflicting free-text instructions or refinement feedback. The resolved settings are reused throughout generation, refinement, and staged-change regeneration.

Inspect the effective configuration, including source paths, imported rule severity, and compatibility diagnostics:

```bash
gsmart config --show-effective
gsmart config --show-effective --language es --history-examples 0
```

Run `--show-effective` separately from flags that save or clear settings. Conflicting update options are rejected before any settings are saved.

Conventions guide AI generation; review the result for accuracy. Git hooks continue to enforce your project's validation. The shared `ResolvedConventions` and effective rule metadata provide the configuration interface for [message validation (#495)](https://github.com/ragnarok22/gsmart/issues/495).

Repository configuration accepts no API keys, OAuth tokens, or provider credentials. Login continues to use the active user-level store selected by `GSMART_CONFIG_DIR`; `gsmart reset` clears that store. Repository files are maintained through Git.

#### Commitlint compatibility

GSmart uses `@commitlint/load` to resolve presets and synchronous/asynchronous rule factories. Referenced presets and plugins must be installed in your repository. JavaScript and TypeScript configuration executes through the standard loader when integration is enabled.

Discovery is limited to the Git root, in this order: the `commitlint` field in `package.json`; `.commitlintrc`, `.commitlintrc.json`, `.commitlintrc.yaml`, `.commitlintrc.yml`; `.commitlintrc.{js,cjs,mjs}`; `commitlint.config.{js,cjs,mjs}`; `.commitlintrc.{ts,cts,mts}`; `commitlint.config.{ts,cts,mts}`. Parent/global and nested configurations are not searched. `package.yaml` manifests are not a discovery source.

| Rule                   | Supported form                                                                    | GSmart setting                              |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| `type-enum`            | `always` with a string array                                                      | `types`                                     |
| `scope-enum`           | `always` with a string array, using commitlint's default `/`, `\`, `,` delimiters | `scopes`                                    |
| `scope-empty`          | `always` / `never`                                                                | `scope: "forbidden"` / `"required"`         |
| `header-max-length`    | `always` with a positive integer or `Infinity`                                    | `headerMaxLength`                           |
| `subject-max-length`   | `always` with a positive integer or `Infinity`                                    | `subjectMaxLength`                          |
| `body-empty`           | `always` / `never`                                                                | `body.presence: "forbidden"` / `"required"` |
| `body-leading-blank`   | `always` / `never`                                                                | `body.leadingBlank: true` / `false`         |
| `body-max-line-length` | `always` with a positive integer or `Infinity`                                    | `body.maxLineLength`                        |
| `footer-leading-blank` | `always` / `never`                                                                | `footer.leadingBlank: true` / `false`       |

Severity `0` disables import of that rule; severities `1` and `2` supply generation conventions and retain warning/error metadata for validation. Empty enum arrays map to `null` (unrestricted), and `Infinity` removes a length limit. Disabled rules contribute no override. Explicit `.gsmartrc.json` values replace mapped rules, including their severity metadata.

Imported values must also fit the schema's bounds (for example, up to 100 enum entries with 100 characters per name). Other rules, inverted enum/length rules, and object-form `scope-enum` values are not translated. Their active rule names appear in `config --show-effective` diagnostics and `--debug` logs. Custom parser formats, plugin behavior, and commitlint ignore predicates do not change GSmart's Conventional Commit format. Invalid config or missing presets produce an actionable load error.

#### Output language and history examples

```bash
# Language override for a single run
gsmart --language es
gsmart --language pt-BR

# Use five recent subjects as style examples
gsmart --history-examples 5

# Disable examples even when the repository enables them
gsmart --history-examples 0
```

Language changes generated commit prose, while CLI help and documentation remain in their existing language.

History is opt-in. When enabled, GSmart reads recent non-merge commit subjects reachable from `HEAD`, bounded to **20 subjects, 200 characters each, and 4,000 subject characters total**. It excludes bodies, labels the subjects as style examples, and sends them to the selected provider alongside the diff. Explicit conventions override historical style. A repository without commits contributes no examples, and disabling history skips the history read entirely.

### Large diffs and AI context

GSmart budgets the **complete request**: system instructions, branch, changes, custom instructions, history examples, refinement feedback, an output reserve, and request overhead. Small diffs that fit keep their full content and use one generation request.

Oversized diffs are reduced locally by default. Each included file keeps its path, change type, line counts, rename origin, and relevant mode/binary metadata. Small patches stay intact where possible; larger patches receive representative excerpts. Lockfiles and generated files receive at most 1 KiB of excerpts so they cannot dominate source changes. Excerpts are incomplete evidence, and the prompt tells the model not to infer unseen details. Lockfile-only, binary, rename-only, and deletion changes remain usable context.

**AI summarization is opt-in.** `--summarize` allows extra requests for oversized source files. Each chunk request is independently budgeted and uses the selected model, authentication, timeout, cancellation, and retry policy. Summaries are composed within the final budget. The default limit is eight summary attempts **including retries**, in addition to final-generation attempts. If a file requires more chunks than its share of the limit, chunks are sampled across the file and its report marks the summary as partial. Large combined summaries can also be shortened for the final request. Lockfiles and generated files continue to use local compaction.

```bash
# Generate and inspect per-file context treatment without committing
gsmart --dry-run --show-context

# Set a total request budget and exclude paths from AI context
gsmart --dry-run --context-budget 16384 --context-exclude 'vendor/**' '*.map'

# Allow additional AI calls for this run
gsmart --dry-run --summarize --show-context

# Override repository opt-in; only local reduction is used
gsmart --dry-run --no-summarize

# Inspect configuration overrides and their sources
gsmart config --show-effective --context-budget 16384 --no-summarize
```

`--show-context` prints a JSON report with the resolved budget and its source, input estimate, output/overhead reserves, summary-attempt count, and each file's treatment (`full`, `condensed`, `summarized`, or `excluded`), reason, byte sizes, and partial-coverage flag. A brief notice appears whenever files are reduced or excluded. This report describes the final context; it does not print source contents. `--dry-run` still makes the final AI request and any opted-in summary requests.

Add a `context` section to the root `.gsmartrc.json` to share settings:

```json
{
  "context": {
    "budgetTokens": 16384,
    "outputTokens": 1024,
    "summarize": false,
    "maxSummaryRequests": 8,
    "exclude": ["vendor/**"],
    "generated": [
      "**/*.min.js",
      "**/*.min.css",
      "**/*.map",
      "**/*.generated.*",
      "**/generated/**",
      "**/dist/**"
    ]
  }
}
```

| Setting              | Default and behavior                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budgetTokens`       | `null`: resolve from the selected provider/model. An explicit integer from 1,024 to 1,048,576 overrides it; it must leave room for instructions and exceed output plus overhead. Known model windows are upper bounds. |
| `outputTokens`       | `1024`: reserved output tokens, also passed to the provider as its output limit; configurable from 256 to 32,768. Increase it if a model exhausts its output/reasoning allowance.                                      |
| `summarize`          | `false`: use local reduction only. `true` permits additional AI calls when needed.                                                                                                                                     |
| `maxSummaryRequests` | `8`: maximum summary attempts per generation/refinement, including retries; range 1–64.                                                                                                                                |
| `exclude`            | `[]`: omit matching files entirely from AI context, including summary requests. For renames/copies, both original and destination paths are checked.                                                                   |
| `generated`          | The six patterns shown above. Recognized generated-code markers also trigger compaction. Setting `[]` disables pattern matching, but retains marker and lockfile detection.                                            |

Patterns match complete repository-relative paths using `/` separators: `*` matches within a component, `**` crosses directories, `**/` also matches the root, and `?` matches one non-separator character. Other characters are literal; negation, brace expansion, and character classes are not supported. Quote CLI patterns to prevent shell expansion. Arrays replace inherited values. CLI context settings override their corresponding repository fields; `config` accepts these flags with `--show-effective` for inspection.

#### Model budgets and conservative accounting

Known exact provider/model pairs use a default total budget of **32,768**, below their advertised windows:

| Provider  | Model                                | Known window |
| --------- | ------------------------------------ | ------------ |
| OpenAI    | `gpt-4o`, `gpt-4o-mini`              | 128,000      |
| OpenAI    | `gpt-5-codex`                        | 400,000      |
| Anthropic | `claude-haiku-4-5-20251001`          | 200,000      |
| Google    | `gemini-2.5-flash`, `gemini-2.5-pro` | 1,048,576    |

All other IDs, including unlisted built-in defaults and **every custom endpoint**, use an **8,192** total fallback unless overridden. A local server may configure a smaller window than the model supports; set `--context-budget` to that effective limit.

With an automatic budget, an output reserve plus framing overhead that reaches or exceeds the 32,768-token automatic cap is rejected while loading configuration, before file selection or auto-staging. Larger output reserves require an explicit larger `budgetTokens`. Model-specific limits are checked after model selection; valid model-dependent settings retain `budgetTokens: null` in the effective configuration.

GSmart conservatively counts **one token per UTF-8 byte** of request text, plus **512 tokens** for request framing, then reserves `outputTokens`. This intentionally overestimates typical token usage instead of assuming four characters per token. The report is an accounting estimate, not provider billing. Custom tokenizers or server-added templates can differ; account for their overhead with a smaller configured budget.

**Context exclusions and reduction never unstage files or change working-tree contents.** All selected changes still belong to the commit; only their AI representation changes. Existing staging and dry-run selection rules still apply. Git capture supports complete diffs up to 64 MiB and returns an explicit error above that limit or on read failure.

If all usable context is excluded, instructions or file metadata cannot fit, or an attempted summary is empty, fails, or exhausts retries, generation stops with a clear error. Increase the relevant limit, shorten instructions/history/feedback, adjust exclusions, or use `--no-summarize` to retry with local reduction. GSmart does not silently continue after a failed summary.

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

ChatGPT streaming responses must complete successfully before becoming commit candidates. Timeouts and interrupted connections discard partial text before retrying. Explicit cancellation stops retries; responses cut short by output limits or content filtering return an error.

<details>
<summary><strong>Where settings live, separate configurations, and resetting</strong></summary>

GSmart stores API keys, ChatGPT login tokens, provider/model preferences, the custom endpoint, and your default prompt in a local, user-level configuration file managed by `conf`. These settings are shared across repositories when you use the same configuration directory. Provider preferences and endpoint credentials are not read from `.gsmartrc.json`.

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

This asks for confirmation, then clears all settings in that configuration store, including provider credentials, ChatGPT login tokens, provider/model defaults, the custom endpoint, and the saved prompt. `gsmart reset --force` skips the confirmation. Resetting clears local settings; credential revocation is managed through your provider.

</details>

## Providers

Run `gsmart login` to configure any of these providers:

| Provider       | `--provider` value | Authentication                                                                          |
| -------------- | ------------------ | --------------------------------------------------------------------------------------- |
| OpenAI         | `openai`           | ChatGPT subscription login or [API key](https://platform.openai.com/api-keys)           |
| Anthropic      | `anthropic`        | [API key](https://console.anthropic.com/settings/keys)                                  |
| Google Gemini  | `google`           | [API key](https://aistudio.google.com/apikey)                                           |
| Mistral        | `mistral`          | [API key](https://console.mistral.ai/api-keys/)                                         |
| Fireworks AI   | `fireworks`        | [API key](https://fireworks.ai/api-keys)                                                |
| PlataformIA    | `plataformia`      | [API key](https://console.plataformia.com/api-keys)                                     |
| Custom / local | `custom`           | Optional bearer token; [configure URL and model](#local-inference-and-custom-endpoints) |

An explicit `--provider` takes precedence over your saved default. Without either, GSmart selects a single configured provider automatically or offers a chooser when several exist. `--yes` uses the first configured entry in the order above when no explicit or saved choice exists.

**Using ChatGPT?** Choose **OpenAI → ChatGPT subscription** during login. GSmart prints an authorization URL and attempts to open it in your browser. Complete authorization on the machine running the CLI so the local callback can finish. Tokens refresh automatically; if the login expires, run `gsmart login` again.

ChatGPT login uses the Codex Responses endpoint with streaming and storage disabled. Its model access differs from the public OpenAI API. Saved OpenAI models and `--model` overrides must be supported by the active authentication mode; use API-key login for API-only models. Fireworks and PlataformIA use Chat Completions, while OpenAI API-key requests use Responses.

<details>
<summary id="which-models-does-gsmart-use"><strong>Which models does GSmart use?</strong></summary>

When neither `--model` nor a saved model is set, the built-in fallbacks are:

| Provider             | Model ID                                                |
| -------------------- | ------------------------------------------------------- |
| OpenAI API key       | `gpt-5.6-luna`                                          |
| OpenAI ChatGPT OAuth | `gpt-5-codex`                                           |
| Anthropic            | `claude-haiku-4-5-20251001`                             |
| Google               | `gemini-3.5-flash-lite`                                 |
| Mistral              | `mistral-large-latest`                                  |
| Fireworks AI         | `accounts/fireworks/models/deepseek-v4-flash`           |
| PlataformIA          | `radiance`                                              |
| Custom / local       | No fallback; configure a model available on your server |

Use `gsmart config --provider <provider> --model <model>` to save another model, or `--model <model>` for one run. `gsmart config --show` identifies saved and built-in models. Availability depends on the provider account, authentication mode, and API operation. Consult your provider's model catalog; an unsupported model produces guidance for selecting another model.

</details>

## Command reference

Run `gsmart` to generate a commit message. `gsmart --help` shows generation options and the available subcommands.

| Command                      | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `gsmart`                     | Generate a message and choose what to do with it              |
| `gsmart login`               | Configure a provider's authentication                         |
| `gsmart config`              | Manage prompts, provider/model defaults, and custom endpoints |
| `gsmart reset`               | Clear the active local configuration after confirmation       |
| `gsmart completions <shell>` | Print a completion script for `bash`, `zsh`, or `fish`        |
| `gsmart help [command]`      | Show help for a command                                       |

**Generation options** — use directly with `gsmart`:

| Option                            | Short | Purpose                                                               |
| --------------------------------- | ----- | --------------------------------------------------------------------- |
| `--provider <provider>`           | `-P`  | Choose an already-configured provider                                 |
| `--model <model>`                 |       | Override the selected provider's saved or built-in model for this run |
| `--prompt <prompt>`               | `-p`  | Supply custom instructions for this run                               |
| `--language <tag>`                |       | Override the generated message's language (`en`, `es`, `pt-BR`)       |
| `--history-examples <count>`      |       | Include 0–20 recent subjects as style examples; `0` disables them     |
| `--context-budget <tokens>`       |       | Set the total request budget, including instructions and output       |
| `--context-exclude <patterns...>` |       | Exclude matching paths from AI context only                           |
| `--summarize` / `--no-summarize`  |       | Enable or disable extra AI summarization requests                     |
| `--show-context`                  |       | Print per-file context treatment and budget accounting                |
| `--yes`                           | `-y`  | Skip generation prompts and commit automatically                      |
| `--dry-run`                       | `-d`  | Generate a message and show analyzed files without committing         |

**Other options:**

| Command and option                                    | Short | Purpose                                                                         |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `gsmart --debug`                                      | `-D`  | Enable diagnostic logging and timing                                            |
| `gsmart --version`                                    | `-V`  | Print the installed version                                                     |
| `gsmart --help`                                       | `-h`  | Show help; also available on subcommands                                        |
| `gsmart config --show`                                | `-s`  | Display prompt, provider/model preferences, endpoint, and authentication status |
| `gsmart config --default-provider <provider>`         |       | Save the default provider                                                       |
| `gsmart config --clear-default-provider`              |       | Return to automatic selection                                                   |
| `gsmart config --provider <provider> --model <model>` |       | Save a model for a provider                                                     |
| `gsmart config --provider <provider> --clear-model`   |       | Remove a saved model                                                            |
| `gsmart config --provider custom --base-url <url>`    |       | Set the Chat Completions base URL                                               |
| `gsmart config --provider custom --api-key <key>`     |       | Set custom endpoint authentication                                              |
| `gsmart config --provider custom --clear-api-key`     |       | Remove custom endpoint authentication                                           |
| `gsmart config --clear-custom-endpoint`               |       | Remove custom endpoint settings and its default-provider selection              |
| `gsmart config --show-effective`                      |       | Display resolved conventions, sources, and diagnostics                          |
| `gsmart config --add-custom-prompt <text>`            |       | Save default writing instructions                                               |
| `gsmart config --clear-custom-prompt`                 |       | Clear default writing instructions                                              |
| `gsmart reset --force`                                | `-f`  | Reset local settings without confirmation                                       |

## Troubleshooting

| What you see                                      | What to try                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsmart: command not found`                       | Confirm the global installation completed and your package manager's global executable directory is on `PATH`.                                                                     |
| No changes found                                  | Run `git status` in the repository and check that you have changes to describe.                                                                                                    |
| No configured providers / provider not configured | Run `gsmart login` or configure a custom endpoint URL and model. Inspect saved defaults with `gsmart config --show`.                                                               |
| Invalid API key or expired ChatGPT login          | Run `gsmart login` again to update the key or repeat browser authorization.                                                                                                        |
| Request timed out / could not reach API           | Check connectivity and start your local server if applicable; verify the host/port and increase `GSMART_TIMEOUT` for slow models.                                                  |
| Rate limited / model unavailable                  | Wait before retrying a rate limit. Check model access or load/download the local model; select another with `--model`.                                                             |
| Endpoint unsupported / unexpected response        | Check that the custom base URL includes `/v1` if required and serves OpenAI-compatible Chat Completions. Native API URLs and Responses-only servers are not supported by `custom`. |
| Failed to commit changes                          | Check your Git identity, repository state, and hook output. GSmart attempts to copy the message to your clipboard as a fallback.                                                   |
| Could not copy message to clipboard               | Copy the printed message directly from the terminal.                                                                                                                               |
| Failed to unstage files after dry-run             | Run `git status` to inspect the index and unstage the files you intended only to preview.                                                                                          |
| Editor failed or edits did not appear             | Check `VISUAL` / `EDITOR` and add a wait flag for GUI editors, such as `code --wait`, then retry **Edit message**.                                                                 |
| Staged content has changed                        | Regenerate for the updated changes, review the new message, then choose **Commit** again.                                                                                          |
| Invalid conventions or malformed JSON             | Fix the reported setting in the root `.gsmartrc.json`; inspect `gsmart config --show-effective` after correcting it.                                                               |
| Could not load commitlint configuration           | Correct the root config or install its referenced presets/plugins; `"commitlint": false` disables this integration.                                                                |

For more detail, combine debug logging with a preview:

```bash
gsmart --debug --dry-run
```

Still stuck? [Open an issue](https://github.com/ragnarok22/gsmart/issues) with your GSmart version, Node.js version, provider, command, and relevant output.

## Shell completions

Enable tab completion for your shell, then start a new terminal session.

Completions work directly with `gsmart`: try `gsmart --<Tab>`, `gsmart --provider <Tab>`, or `gsmart config --<Tab>`. The older `gsmart generate` invocation remains available as a hidden compatibility alias, but is omitted from command suggestions and the main help listing.

**Updating an existing setup?** For Bash and Zsh, reload the completion definition with the `eval` command below or start a new terminal. For Fish, regenerate the saved completion file and start a new terminal.

If your shell startup caches generated completion scripts, regenerate that cached copy after updating GSmart so new sessions load the current definitions too.

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

Use **Node.js 22.12.0+** (`.nvmrc` pins the development version) and the **pnpm version pinned in `package.json`**.

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

`pnpm run dev` watches the bundle; run the CLI in another terminal to try your changes. Build and typecheck run the metadata-generation hook automatically. Coverage runs the full suite once under c8, which maps results back to the TypeScript source and merges coverage from mocked module instances. New `test/*.test.ts` files are included automatically.

Native completion tests use Bash, Zsh, Fish, and Python 3 (for Zsh's terminal harness). Locally, suites for unavailable shells are skipped. CI installs all three shells and sets `GSMART_REQUIRE_SHELL_TESTS=1` so missing runtimes fail the checks. Set `GSMART_TEST_BASH`, `GSMART_TEST_ZSH`, or `FISH` to test a specific shell executable.

</details>

<details>
<summary><strong>Find your way around the code</strong></summary>

| Location                    | Responsibility                                           |
| --------------------------- | -------------------------------------------------------- |
| `src/index.ts`              | CLI startup, lifecycle output, and signal handling       |
| `src/program.ts`            | Testable command registration, root action, and alias    |
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
