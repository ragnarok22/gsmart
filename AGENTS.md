# Repository Guidelines

## Project Structure & Module Organization

- Source lives in `src/`; commands (CLI entrypoints) sit in `src/commands`, reusable helpers in `src/utils`, and the CLI bootstrap is `src/index.ts`.
- Shared types and definitions belong in `src/definitions.ts`; keep command registration changes localized to `src/gsmart.ts`.
- Runtime artifacts compile to `dist/` via tsup—never edit this directory manually.
- Tests reside in `test/` alongside fixtures; mirror the source file name with a `.test.ts` suffix when adding coverage.

## Build, Test, and Development Commands

- `pnpm install` ensures dependencies match the lockfile; prefer pnpm for all commands.
- `pnpm run dev` launches tsup in watch mode for fast local iteration.
- `pnpm run build` compiles TypeScript to ESM output in `dist/`.
- `pnpm test` runs the tsx-powered test suite; combine with `pnpm test -- --watch` during development.
- `pnpm run lint` and `pnpm run prettier` enforce linting and formatting before submitting work.

## Coding Style & Naming Conventions

- TypeScript with ES modules and top-level await is standard; keep imports absolute from `src/`.
- Use 2-space indentation, trailing commas where valid, and single quotes only when required by the linter.
- Prefer descriptive function names like `generateCommitSummary`; CLI subcommands should be kebab-case (`generate-message`).
- Run `pnpm run lint` after touching config or CLI glue code to catch unused exports and type regressions.

## Testing Guidelines

- Unit tests use Node’s built-in test runner under tsx; place new specs in `test/*.test.ts`.
- Name tests after the behavior (`"generates default prompt when none provided"`) and isolate API calls using mocks from `src/utils`.
- New features require accompanying tests or rationale when coverage is impractical; update existing tests if command signatures change.

## Commit & Pull Request Guidelines

- Follow Conventional Commits (`type(scope): summary`); scopes typically mirror subdirectories (`feat(utils): add provider cache`).
- Generate messages with `pnpm exec gsmart` whenever possible to stay consistent with project tone.
- Squash commits prior to merge unless multiple meaningful milestones must remain.
- PRs must describe the user-facing impact, reference related issues, and include screenshots or CLI transcripts when behavior changes.
