# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GSmart is a CLI tool that generates smart commit messages using AI. It analyzes git changes and creates conventional commit messages using various AI providers (OpenAI, Anthropic, Google, Mistral, Fireworks AI, PlataformIA).

## Development Commands

- **Build**: `pnpm run build` - Compiles TypeScript to ESM format using tsup
- **Development**: `pnpm run dev` - Runs tsup in watch mode for development
- **Start**: `pnpm run start` - Runs the compiled CLI from dist/index.js
- **Test**: `pnpm test` - Runs Node.js built-in test runner with tsx
- **Lint**: `pnpm run lint` - Runs ESLint on TypeScript files
- **Format**: `pnpm run format` - Formats code with Prettier

The project uses pnpm as package manager and requires Node.js with ESM support.

## Architecture

### Core Structure

- **Entry Point**: `src/index.ts` - CLI setup using Commander.js with signal handling
- **Commands**: `src/commands/` - Command implementations (generate, login, reset)
- **AI Integration**: `src/utils/ai.ts` - AI provider abstraction and prompt building
- **Git Operations**: `src/utils/git.ts` - Git command wrappers for status, diff, and commits
- **Configuration**: `src/utils/config.ts` - Persistent storage for API keys using conf package

### Command Architecture

The CLI follows a command pattern where:

- Each command exports an `ICommand` object with name, description, options, and action
- Commands are registered in `src/gsmart.ts` and loaded by the main program
- The default command is "generate" which analyzes staged changes and creates commit messages

### AI Provider System

- Multiple AI providers supported through unified `AIBuilder` class
- Each provider uses different models (GPT-4o, Claude, Gemini, Mistral, etc.)
- Providers configured with specific base URLs and model names
- API keys stored securely using the conf package

### Git Integration

- Uses `execSync` for git commands (status, diff, commit)
- Parses `git status --porcelain` for file change detection
- Requires staged changes in git to generate commit messages
- Supports commit message generation based on git diff output

## Key Design Patterns

### Type Safety

- Strong TypeScript typing throughout with interfaces for commands, providers, and git status
- Provider types constrained to specific string literals
- Git status enum for file change types (Modified, Deleted, Untracked)

### Error Handling

- AI generation returns union types (string | {error: string}) for graceful error handling
- Git operations wrapped in try-catch with boolean success indicators
- CLI provides user-friendly error messages with ora spinner feedback

### User Experience

- Interactive prompts using the prompts package for provider selection and actions
- Loading spinners with ora for long-running operations
- Chalk for colored terminal output
- Clipboard integration for commit message copying

## Testing

Uses Node.js built-in test runner with tsx for TypeScript support. Tests are located in `test/` directory. Example test execution: `pnpm test` runs all .test.ts files.

## Build System

- **tsup**: TypeScript bundler configured for ESM output with declarations
- **Target**: esnext with source maps and minification
- **Output**: Single ESM bundle in `dist/` directory suitable for npm publishing
- **Pre-build**: Custom prebuild.js script (generates build info)
