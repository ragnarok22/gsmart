# Repository Guidelines

## Project Structure & Module Organization

Keep runtime logic under `src/` and treat the compiled `dist/` output as read-only artifacts. Align new files with existing module boundaries so command glue stays isolated from shared utilities.

- `src/commands/` holds CLI entrypoints; prefer one file per subcommand.
- `src/utils/` aggregates reusable helpers; keep side effects out of this layer.
- `src/index.ts` bootstraps the CLI, while `src/gsmart.ts` wires command registration.
- `src/definitions.ts` centralizes shared types; update consumers rather than duplicating interfaces.
- Tests live in `test/` and mirror source filenames with a `.test.ts` suffix.

## Build, Test, and Development Commands

Use pnpm for every workflow to stay aligned with the lockfile. Scripts assume Node ESM semantics and tsup bundling.

- `pnpm install` syncs dependencies.
- `pnpm run dev` runs tsup in watch mode for rapid iteration.
- `pnpm run build` produces the production bundle in `dist/`.
- `pnpm test` executes the tsx-powered test suite; append `-- --watch` while developing.
- `pnpm run lint` and `pnpm run prettier` enforce TypeScript, ESLint, and formatting checks.

## Coding Style & Naming Conventions

Author TypeScript with 2-space indentation, trailing commas where allowed, and default double quotes. Import modules from `src/` using absolute paths. Favor descriptive verbs (`generateCommitSummary`) and kebab-case command names (`generate-message`). Run linting after touching CLI glue to surface unused exports or type drift.

## Testing Guidelines

New features require unit coverage or a written justification when impractical. Tests run on Node's built-in runner via tsx; isolate side effects with fakes from `src/utils`. Name cases after observable behavior (e.g., `"generates default prompt when none provided"`) and keep fixtures adjacent to their specs in `test/`.

## Commit & Pull Request Guidelines

Follow Conventional Commits (`type(scope): summary`), with scopes that mirror directories (`feat(utils): add provider cache`). Generate commit messages with `pnpm exec gsmart` when feasible. Squash before merge unless preserving milestones. Pull requests must describe user-facing impact, link related issues, and provide screenshots or CLI transcripts when behavior changes.

## Security & Configuration Tips

Do not commit secrets; rely on local environment variables and `.env` files excluded from source control. Review `SECURITY.md` before reporting vulnerabilities and coordinate with maintainers for disclosure timelines.
