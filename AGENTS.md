# AGENTS.md

## Setup and generated files

- Single-package TypeScript/ESM CLI. Use Node.js >=22 (`.nvmrc` pins 22.14.0) and the pnpm version pinned in `package.json`.
- Install with `pnpm install --frozen-lockfile`. `pnpm-workspace.yaml` configures esbuild's build permission, not additional packages. The lockfile contains multiple YAML documents; let pnpm manage it.
- `prebuild.js` generates ignored `src/build-info.ts` from `package.json`. Build and typecheck have pre-hooks; run `pnpm run prebuild` before `pnpm run dev` or direct source execution on a fresh checkout. Do not hand-edit build metadata or `dist/`.
- `pnpm run dev` only watches the bundle. Run the CLI with `pnpm exec tsx src/index.ts <args>`, or `pnpm run build` then `node dist/index.js <args>`. Local login is `pnpm exec tsx src/index.ts login`; `pnpm login` authenticates to the package registry.

## Verification

- `pnpm run check` runs lint → typecheck → tests. Formatting is separate: `pnpm run format:check`; for a focused check, `pnpm exec prettier --check <files>`.
- `pnpm test` uses Node's test runner with tsx and a required esmock registration hook. For a single file, run from the repo root:

  ```sh
  pnpm exec node --import ./test-support/register-esmock.mjs --import tsx --test test/ai.test.ts
  ```

  Add `--test-name-pattern="name fragment"` or `--watch` before the test path. The package test script hardcodes `test/*.test.ts`, so use the direct command for focused runs.

- Coverage: `pnpm run test:coverage`. This runs the full suite once under c8 and writes source-mapped coverage for `src/**/*.ts` to `coverage/lcov.info`. c8 merges esmock's separately loaded module copies; keep the esmock registration hook in `pnpm test`. New `test/*.test.ts` files are automatically included.
- Native completion tests use Bash, Zsh, Fish, and Python 3 (for Zsh's PTY/ZLE harness). Missing-shell suites skip locally; `GSMART_REQUIRE_SHELL_TESTS=1` makes missing runtimes fail in CI. `GSMART_TEST_BASH`, `GSMART_TEST_ZSH`, and `FISH` can override shell executables.
- Tests that load config should import `../test-support/setup-env` first. Config creates its `Conf` store at module load; `GSMART_CONFIG_DIR` must be set beforehand. The helper creates a temporary directory only if the variable is unset, so any supplied override must be disposable.
- Use the dependency-injected `createMainCommand` factory for command tests and esmock for AI/module boundaries; retry tests can inject `delayFn`. Git tests use real temporary repositories and need `git` available.
- Typecheck covers `src/` only; passing it does not validate test-file types. New features need unit coverage in `test/*.test.ts`.

## Code style and implementation patterns

- Prettier uses its defaults (no custom config): 2-space indentation, double quotes, semicolons, and trailing commas. Format touched files with `pnpm exec prettier --write <files>`.
- Source imports are relative and usually extensionless; `tsconfig.json` uses bundler resolution and defines no `src/` alias. Tests also use explicit `.ts` imports; follow the surrounding file.
- TypeScript is strict, but `noUnusedLocals` and `noUnusedParameters` are disabled; ESLint's TypeScript recommended rules check unused bindings and explicit `any`. Typecheck alone does not enforce these rules.
- Follow the command factory pattern in `src/commands/main.ts` and `config.ts`: named `create*Command(deps: Partial<...> = {})`, merge with `defaultDeps`, and default-export the instantiated `ICommand`. Keep prompts, spinners, config, and logging injectable.
- Shared CLI/provider/Git contracts live in `src/definitions.ts`; command-specific option and dependency types stay beside their implementation. `ICommand.action` receives `Record<string, unknown>`; adapt it to the local options type at the action boundary.
- CLI flags use kebab-case, while Commander exposes camelCase option keys: `--dry-run` → `dryRun`, `--add-custom-prompt` → `addCustomPrompt`. Positional arguments are copied into the same options object by `src/index.ts`.

## Wiring and behavior

- `src/program.ts` turns `ICommand` objects into Commander commands; `src/index.ts` handles startup and signals. The default descriptor's action and options live on the root command, with its name retained as a hidden compatibility alias. Silent commands skip welcome, update, and holiday output. Export new commands through `src/commands/index.ts` and register them in `src/gsmart.ts`. Shell completions maintain a separate `allCommands` list in `src/commands/completions.ts`; update it too (a regression test checks it against the CLI registry).
- Provider changes span `src/definitions.ts` (provider union), `src/utils/providers.ts` (choices), `src/utils/config.ts` (credentials/validation), and `src/utils/ai.ts` (models, endpoints, generation). OpenAI also supports ChatGPT OAuth via `src/utils/openai-oauth.ts`; configured-provider detection must account for tokens as well as API keys.
- `AIBuilder` returns a message or `{ error: string }` for handled generation failures. Timeout comes from `GSMART_TIMEOUT`; retry defaults live in `src/utils/constants.ts`.
- Git wrappers use argument arrays and NUL-delimited `git status --porcelain -z`. Preserve rename/copy `original_path` handling when changing parsing or staging.
- `retrieveFilesToCommit` in `src/utils/index.ts` returns an existing staged diff immediately; auto-staging only happens when that diff is empty. `--yes` proceeds to commit. `--dry-run` still authenticates and calls AI, and can temporarily stage/unstage files.

## Repository workflows

- `CLAUDE.md` is a symlink to this file; keep one instruction source.
- Use Conventional Commits with directory scopes, e.g. `feat(utils): ...`. Include a CLI transcript for behavior-changing PRs.
- Release preparation is documented in `.claude/commands/release.md`. Pushing a `v*` tag triggers `.github/workflows/release.yml` to build, test, create a GitHub release, and publish to npm; release preparation stops before pushing.
