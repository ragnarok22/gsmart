# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.2] - 2026-04-13

### Changed

- Updated AI SDK packages (@ai-sdk/anthropic 3.0.63→3.0.69, @ai-sdk/google 3.0.52→3.0.62, @ai-sdk/mistral 3.0.27→3.0.30, ai 6.0.116→6.0.146)
- Updated development tooling (eslint 10.0.3→10.2.0, typescript-eslint 8.54.0→8.58.1, globals 17.3.0→17.5.0)
- Updated CI workflows (Codecov action to v6, pnpm action to v5)
- Skipped format check for Dependabot runs in CI
- Regenerated pnpm lockfile

## [0.13.1] - 2026-03-26

### Fixed

- Show shell completion instructions on first run instead of postinstall
- Fallback to default timeout when `GSMART_TIMEOUT` env var contains an invalid value
- Stop staging original file paths for renamed files

### Changed

- Updated AI SDK packages (@ai-sdk/anthropic 3.0.58→3.0.63, @ai-sdk/google 3.0.43→3.0.52, @ai-sdk/mistral 3.0.24→3.0.27)
- Updated AI SDK dependencies and adjusted tsconfig paths
- Updated development tooling (@eslint/json 1.1.0→1.2.0)
- Bumped picomatch and flatted in the npm_and_yarn group
- Refreshed project structure overview in README
- Added test coverage for auto-staging unstaged renames

## [0.13.0] - 2026-03-15

### Added

- Debug logging mode with `--debug` CLI flag and timing for commit generation
- Retry handling for AI text generation with user feedback on retries
- Detailed error classification for provider errors (network, auth, rate-limit)
- Dry-run option (`--dry-run`) to preview staged files without committing
- API key validation before generating commits
- Interactive config command for custom prompt management (set, get, clear)
- Shell completion entries for the new debug flag
- Integration tests for MainCommand, LoginCommand, and ResetCommand
- Expanded test coverage for AIBuilder, retry logic, error handling, clipboard, and dry-run workflows

### Fixed

- Trim API keys before validating prefix to handle whitespace
- Handle clipboard write failures gracefully instead of crashing
- Handle provider network errors that lack an HTTP status code
- Return original error message for non-network TypeError
- Warn when dry-run file unstage fails
- Derive file names from diff output in dry-run mode
- Require network keyword for type error retries to avoid false positives

### Changed

- Shifted git status error handling to the caller for cleaner separation
- Replaced spread with `Array.from` when deduplicating file names
- Refreshed provider and agent descriptions in documentation
- Added format check to CI test workflow
- Formatted command imports and exports for readability
- Updated ESLint JSON and typescript-eslint packages

## [0.12.0] - 2026-03-09

### Added

- Shell completion generator command for bash, zsh, and fish shells
- Shell completions generated from command metadata
- Post-install message with shell completion instructions
- Option for silent commands to skip holiday message

### Fixed

- Request timeout handling for AI commit generation (30s default, configurable via `GSMART_TIMEOUT` env var)
- Zsh subcommand dispatch in shell completions using correct `$line[1]` syntax

### Changed

- Documented AI timeout configuration and constants.ts
- Documented shell completions support
- Added instructions for write-conventional-commit skill to README
- Removed unused zod dependency
- Updated AI SDK packages (@ai-sdk/google 3.0.34→3.0.43, @ai-sdk/mistral 3.0.21→3.0.24, @ai-sdk/openai 3.0.37→3.0.41, ai 6.0.77→6.0.116)
- Updated development tooling (eslint 9.39.2→10.0.3)
- Updated package manager metadata from pnpm 10.30.3 to 10.31.0

## [0.11.3] - 2026-03-02

### Changed

- Updated AI and runtime dependency ranges (@ai-sdk/anthropic 3.0.15→3.0.35, @ai-sdk/google 3.0.10→3.0.20, @ai-sdk/mistral 3.0.9→3.0.18, @ai-sdk/openai 3.0.12→3.0.25, ai 6.0.40→6.0.67, clipboardy 5.0.2→5.2.0, commander 14.0.2→14.0.3, ora 9.0.0→9.1.0, zod 4.3.5→4.3.6)
- Updated development tooling (@eslint/json 0.14.0→1.0.0, globals 17.0.0→17.3.0, prettier 3.8.0→3.8.1, typescript-eslint 8.53.0→8.54.0)
- Updated package manager metadata from pnpm 10.28.1 to 10.30.3
- Refreshed the lockfile with Dependabot updates for resolved dependency versions and security fixes

## [0.11.2] - 2026-01-19

### Changed

- Simplified test script globs and switched to node --import tsx for test execution
- Added lint/typecheck steps to release CI workflow and configured publish environment
- Refined package exports and added maintenance scripts
- Removed unused fs-extra and related packages from dependencies
- Updated package metadata with additional keywords and bugs URL
- Documented release workflow instructions and additional commands
- Updated AI SDK packages (@ai-sdk/anthropic 3.0.12→3.0.15, @ai-sdk/google 3.0.7→3.0.10, @ai-sdk/mistral 3.0.6→3.0.9, @ai-sdk/openai 3.0.9→3.0.12, ai 6.0.7→6.0.40)
- Updated development tooling (globals 16.5.0→17.0.0, prettier 3.7.3→3.8.0, typescript-eslint 8.51.0→8.53.0, pnpm 10.x→10.28.1)
- Expanded test coverage for holiday messages, version checks, git status formatting, and utility functions

### Fixed

- Corrected rename status parsing and path ordering in git utils
- Fixed movable holiday date calculations for accurate seasonal messages

## [0.11.1] - 2026-01-04

### Changed

- Raised minimum Node.js version to 20 and refreshed provider docs to reflect the GPT-5 Codex default
- Updated AI SDK packages (@ai-sdk/anthropic 3.0.1→3.0.2, @ai-sdk/google 3.0.1→3.0.2, @ai-sdk/mistral 3.0.1→3.0.2, @ai-sdk/openai 3.0.1→3.0.2, ai 6.0.3→6.0.6, zod 4.2.1→4.3.5, typescript-eslint 8.50.1→8.51.0)

### Fixed

- Git status parsing now preserves rename/copy scores and original paths when reporting changes

## [0.11.0] - 2026-01-01

### Added

- Seasonal message rotation logic for festive occasions throughout the year

### Changed

- Updated AI SDK packages (@ai-sdk/anthropic 2.0.53→2.0.56, @ai-sdk/google 2.0.46→2.0.51, @ai-sdk/mistral 2.0.25→2.0.26)
- Updated fs-extra from 11.3.2 to 11.3.3
- Updated typescript-eslint from 8.49.0 to 8.50.1

### Fixed

- Holiday messages now restricted to specific dates for better user experience
- Adjusted update banner padding for cleaner display in version check notifications

## [0.10.4] - 2025-12-29

### Added

- Festive holiday message displayed after each command execution
- Test coverage for unstaged modified files in git status parsing

### Fixed

- Git status parsing now correctly detects modified files that are not staged
- Regex pattern updated to match all git status codes including those with leading spaces

## [0.10.3] - 2025-12-03

### Changed

- Updated AI SDK packages (@ai-sdk/anthropic 2.0.44→2.0.53, @ai-sdk/google 2.0.31→2.0.44, @ai-sdk/mistral 2.0.24→2.0.25, @ai-sdk/openai 2.0.65→2.0.76, ai 5.0.93→5.0.106)
- Updated prettier from 3.7.2 to 3.7.3
- Updated typescript-eslint from 8.46.2 to 8.48.1

## [0.10.2] - 2025-12-01

### Changed

- Publish workflow now uses npm provenance signing and defaults to public access for releases
- Package publish configuration now opts into provenance by default

## [0.10.1] - 2025-11-13

### Changed

- Updated AI SDK packages (@ai-sdk/anthropic 2.0.37→2.0.44, @ai-sdk/google 2.0.23→2.0.31, @ai-sdk/openai 2.0.52→2.0.65, ai 5.0.70→5.0.93)
- Updated @ai-sdk/mistral to 2.0.24
- Updated commander from 14.0.1 to 14.0.2
- Updated development tooling (@eslint/json 0.13.2→0.14.0, @eslint/js 9.37.0→9.39.1, eslint 9.37.0→9.39.1, typescript-eslint 8.46.1→8.46.2)

## [0.10.0] - 2025-10-14

### Added

- Automatic update checking on CLI startup with update-notifier
- Test coverage reporting with Node.js built-in coverage support
- Codecov integration in GitHub Actions workflow
- Coverage badge in README

### Changed

- Fixed typecheck error in CI by running prebuild before typecheck to generate build-info.ts
- Updated AI SDK packages (@ai-sdk/anthropic, @ai-sdk/google, ai)
- Updated linting tooling (ESLint, typescript-eslint)
- Updated dependencies (zod, conf, type-fest)
- Removed redundant top-level heading from README
- Removed bundle size badge from README

## [0.9.7] - 2025-10-05

### Changed

- Default OpenAI builder configuration to `gpt-5-codex` for more accurate summaries
- Refresh AI SDK, TypeScript, and linting dependencies

### Fixed

- Improve type safety across AI prompt construction utilities

## [0.9.6] - 2025-09-29

### Added

- `--yes` (`-y`) flag for non-interactive mode to automatically commit without prompting
- Auto-selection of first available AI provider when using `--yes` flag
- Support for CI/CD and automation workflows with unattended operation

### Changed

- Enhanced command-line interface with automation-friendly options
- Improved user experience for both interactive and non-interactive usage

## [0.9.5] - 2025-09-22

### Added

- GitHub Actions workflow for automated releases and npm publishing
- Enhanced README with features overview, usage examples, and development guide
- Project documentation in CLAUDE.md with architecture overview
- ESLint ignore rules for `dist/` and `build/` directories

### Changed

- Improved documentation structure and clarity
- Updated release automation with modern GitHub Actions

## [0.9.4] - 2024-12-XX

### Changed

- Updated TypeScript ESLint from 8.43.0 to 8.44.0
- Dependency maintenance and security updates

### Fixed

- Various dependency vulnerabilities addressed

## [0.9.3] - 2024-12-XX

### Added

- Support for multiple AI providers with improved provider selection
- Enhanced error handling and user feedback

### Changed

- Improved AI provider abstraction
- Better command-line interface with cleaner prompts

## [0.9.2] - 2024-11-XX

### Added

- PlataformIA provider support with Radiance model
- Enhanced conventional commit message generation

### Changed

- Updated AI SDK dependencies for better performance
- Improved provider configuration management

## [0.9.1] - 2024-11-XX

### Fixed

- Configuration file handling improvements
- Better error messages for missing API keys

### Changed

- Updated dependencies for security and performance

## [0.9.0] - 2024-11-XX

### Added

- Major rewrite with improved architecture
- Support for OpenAI GPT-4o model
- Support for Anthropic Claude model
- Support for Google Gemini 2.0 Flash model
- Support for Mistral Large model
- Support for Fireworks AI FireFunction V1 model
- Interactive provider selection during login
- Secure API key storage using conf package
- Conventional commits format support
- Clipboard integration for generated commit messages

### Changed

- Complete CLI redesign with Commander.js
- Improved user experience with ora spinners and chalk colors
- Better error handling and validation
- TypeScript rewrite for better maintainability

### Removed

- Legacy provider implementations
- Outdated configuration methods

## [0.8.3] - 2024-10-XX

### Fixed

- Git status parsing improvements
- Better handling of staged changes detection

### Changed

- Updated AI SDK dependencies

## [0.8.2] - 2024-10-XX

### Added

- Enhanced git diff analysis
- Better commit message context understanding

### Fixed

- Issues with large diffs causing timeout errors

## [0.8.1] - 2024-10-XX

### Fixed

- Configuration persistence issues
- Provider authentication error handling

### Changed

- Improved CLI help documentation

## [0.8.0] - 2024-10-XX

### Added

- Initial stable release
- Basic AI-powered commit message generation
- Support for OpenAI and Anthropic providers
- Git integration for staged changes analysis
- Interactive CLI with prompts

### Features

- 🎯 Smart commit message generation based on git changes
- 🔄 Multiple AI provider support
- 📋 Interactive command-line interface
- 🔒 Secure API key management
- ⚡ Fast analysis and generation
- 📖 Conventional commits format

---

## Release Notes

### Version Numbering

- **Major** (X.0.0): Breaking changes, major feature additions
- **Minor** (0.X.0): New features, provider additions, significant improvements
- **Patch** (0.0.X): Bug fixes, dependency updates, minor improvements

### Supported Providers

As of v0.9.0, GSmart supports the following AI providers:

- OpenAI (GPT-4o)
- Anthropic (Claude)
- Google (Gemini 2.0 Flash)
- Mistral (Mistral Large)
- Fireworks AI (FireFunction V1)
- PlataformIA (Radiance)

### Dependencies

GSmart is built with modern technologies:

- Node.js 20+ with ESM support
- TypeScript for type safety
- Commander.js for CLI framework
- AI SDK for provider integrations
- Various utilities for enhanced UX

[Unreleased]: https://github.com/ragnarok22/gsmart/compare/v0.13.2...HEAD
[0.13.2]: https://github.com/ragnarok22/gsmart/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/ragnarok22/gsmart/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/ragnarok22/gsmart/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/ragnarok22/gsmart/compare/v0.11.3...v0.12.0
[0.11.3]: https://github.com/ragnarok22/gsmart/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/ragnarok22/gsmart/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/ragnarok22/gsmart/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/ragnarok22/gsmart/compare/v0.10.4...v0.11.0
[0.10.4]: https://github.com/ragnarok22/gsmart/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/ragnarok22/gsmart/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/ragnarok22/gsmart/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/ragnarok22/gsmart/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/ragnarok22/gsmart/compare/v0.9.7...v0.10.0
[0.9.7]: https://github.com/ragnarok22/gsmart/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/ragnarok22/gsmart/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/ragnarok22/gsmart/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/ragnarok22/gsmart/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/ragnarok22/gsmart/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/ragnarok22/gsmart/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/ragnarok22/gsmart/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/ragnarok22/gsmart/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/ragnarok22/gsmart/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/ragnarok22/gsmart/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/ragnarok22/gsmart/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/ragnarok22/gsmart/releases/tag/v0.8.0
