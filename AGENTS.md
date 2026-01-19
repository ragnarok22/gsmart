# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

GSmart is a CLI tool that generates smart commit messages using AI. It analyzes git changes and creates conventional commit messages using various AI providers (OpenAI, Anthropic, Google, Mistral, Fireworks AI, PlataformIA).

## Project Structure

```
src/
├── index.ts          # CLI bootstrap with Commander.js and signal handling
├── gsmart.ts         # Command registration and wiring
├── definitions.ts    # Shared types and interfaces
├── commands/         # CLI command implementations (one file per command)
│   ├── generate.ts   # Default command for commit message generation
│   ├── login.ts      # API key configuration
│   └── reset.ts      # Configuration reset
└── utils/            # Reusable helpers (side-effect free)
    ├── ai.ts         # AI provider abstraction and prompt building
    ├── config.ts     # Persistent API key storage using conf package
    └── git.ts        # Git command wrappers for status, diff, commits

test/                 # Tests mirror source with .test.ts suffix
dist/                 # Compiled output (read-only, gitignored)
```

## Development Commands

Use **pnpm** for all workflows. Requires Node.js >=20 with ESM support.

| Command                  | Description                         |
| ------------------------ | ----------------------------------- |
| `pnpm install`           | Install dependencies                |
| `pnpm run dev`           | Watch mode for development          |
| `pnpm run build`         | Production bundle to `dist/`        |
| `pnpm run start`         | Run compiled CLI from dist/index.js |
| `pnpm test`              | Run test suite                      |
| `pnpm run test:coverage` | Run tests with coverage report      |
| `pnpm test -- --watch`   | Run tests in watch mode             |
| `pnpm run lint`          | ESLint checks                       |
| `pnpm run lint:fix`      | ESLint with auto-fix                |
| `pnpm run typecheck`     | TypeScript type checking            |
| `pnpm run format`        | Format with Prettier                |
| `pnpm run format:check`  | Check formatting without writing    |
| `pnpm run check`         | Run lint, typecheck, and test       |
| `pnpm run clean`         | Remove dist directory               |

## Architecture

### Command Architecture

The CLI follows a command pattern:

- Each command exports an `ICommand` object with name, description, options, and action
- Commands are registered in `src/gsmart.ts` and loaded by the main program
- The default command is "generate" which analyzes staged changes and creates commit messages

### AI Provider System

- Multiple providers supported through unified `AIBuilder` class
- Supported providers: OpenAI, Anthropic, Google, Mistral, Fireworks AI, PlataformIA
- Models: gpt-5-codex, claude-3-5-haiku-latest, gemini-2.0-flash, mistral-large-latest, firefunction-v1, radiance
- API keys stored securely using the conf package

### Git Integration

- Uses `spawnSync` for git commands (status, diff, commit)
- Parses `git status --porcelain` for file change detection
- Requires staged changes to generate commit messages

## Key Design Patterns

### Type Safety

- Strong TypeScript typing with interfaces for commands, providers, and git status
- Provider types constrained to specific string literals
- Git status enum for file change types (Modified, Deleted, Untracked)

### Error Handling

- AI generation returns union types `string | {error: string}` for graceful error handling
- Git operations wrapped in try-catch with boolean success indicators
- CLI provides user-friendly error messages with ora spinner feedback

### User Experience

- Interactive prompts using the prompts package for provider selection
- Loading spinners with ora for long-running operations
- Chalk for colored terminal output
- Clipboard integration for commit message copying

## Build System

- **Bundler**: tsup configured for ESM output with declarations
- **Target**: esnext with source maps and minification
- **Output**: Single ESM bundle in `dist/` directory
- **Pre-build**: Custom prebuild.js script generates build info
- **Module Resolution**: Uses `bundler` moduleResolution for modern ESM
- **Tree-shaking**: Package marked with `sideEffects: false`

## Coding Style

- **Indentation**: 2 spaces
- **Quotes**: Double quotes
- **Trailing commas**: Where allowed
- **Imports**: Use absolute paths from `src/`
- **Functions**: Descriptive verbs (e.g., `generateCommitSummary`)
- **Command names**: kebab-case (e.g., `generate-message`)

Run `pnpm run lint` after changes to catch unused exports or type drift.

## Testing Guidelines

- New features require unit test coverage
- Tests use Node.js built-in test runner with tsx
- Name tests after observable behavior: `"generates default prompt when none provided"`
- Isolate side effects with fakes from `src/utils`
- Keep fixtures adjacent to specs in `test/`

## Commit & Pull Request Guidelines

Follow **Conventional Commits**: `type(scope): summary`

- Scopes mirror directories: `feat(utils): add provider cache`
- Use `pnpm exec gsmart` to generate commit messages
- Squash before merge unless preserving milestones
- PRs must describe user-facing impact and link related issues
- Include CLI transcripts or screenshots for behavior changes

### Commit Types

| Type       | Description                     |
| ---------- | ------------------------------- |
| `feat`     | New feature                     |
| `fix`      | Bug fix                         |
| `docs`     | Documentation only              |
| `style`    | Formatting, no logic change     |
| `refactor` | Code change without feature/fix |
| `test`     | Adding or updating tests        |
| `chore`    | Build, tooling, dependencies    |

## Security

- Never commit secrets or API keys
- Use environment variables and `.env` files (excluded from source control)
- Review `SECURITY.md` before reporting vulnerabilities
- Coordinate with maintainers for disclosure timelines
