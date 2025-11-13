# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- Node.js 18+ with ESM support
- TypeScript for type safety
- Commander.js for CLI framework
- AI SDK for provider integrations
- Various utilities for enhanced UX

[Unreleased]: https://github.com/ragnarok22/gsmart/compare/v0.10.1...HEAD
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
