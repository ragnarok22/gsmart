# Release Command

Create a new release for the project.

## Instructions

Follow these steps to create a new release:

### Step 1: Gather Information

First, get the current state:

1. Get the current version from package.json
2. Get the last git tag: `git describe --tags --abbrev=0`
3. Get the commit log since the last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges`

### Step 2: Ask for Version Type

If no argument was provided ($ARGUMENTS is empty), ask the user to choose the version bump type:

- **patch**: Bug fixes and minor changes (x.x.X)
- **minor**: New features, backward compatible (x.X.0)
- **major**: Breaking changes (X.0.0)

If $ARGUMENTS contains "patch", "minor", or "major", use that directly.

### Step 3: Calculate New Version

Based on the current version and bump type, calculate the new version number.

### Step 4: Update CHANGELOG.md

Update the CHANGELOG.md file following the [Keep a Changelog](https://keepachangelog.com/) format:

1. Read the git commits since the last tag
2. Categorize commits based on conventional commit prefixes:
   - `feat:` or `feat(...):` → **Added**
   - `fix:` or `fix(...):` → **Fixed**
   - `refactor:`, `perf:`, `style:` → **Changed**
   - `build:`, `chore:`, `ci:` → **Changed** (dependency updates, build changes)
   - `docs:` → **Changed** (documentation)
   - `BREAKING CHANGE` or `!:` → **Changed** (note as breaking)

3. Move content from `[Unreleased]` section to the new version section
4. Add the new version header with today's date: `## [X.Y.Z] - YYYY-MM-DD`
5. Group changes under appropriate headers (### Added, ### Changed, ### Fixed, ### Removed)
6. Keep entries concise but descriptive
7. If no conventional commit prefix, categorize based on content or put under **Changed**

### Step 5: Update package.json

Update the `version` field in package.json to the new version number.

### Step 6: Create Commit

Stage and commit the changes:

```bash
git add CHANGELOG.md package.json pnpm-lock.yaml
git commit -m "chore(release): v{NEW_VERSION}"
```

### Step 7: Create Tag

Create an annotated tag:

```bash
git tag -a v{NEW_VERSION} -m "Release v{NEW_VERSION}"
```

### Step 8: Summary

After completing all steps, show the user:

- The new version number
- A summary of changelog entries
- The git commands to push the release: `git push && git push --tags`

Do NOT push automatically - let the user review and push manually.

## Example Output

```
Release v0.12.0 created successfully!

Changelog updates:
- Added: New feature X
- Fixed: Bug in Y
- Changed: Updated dependencies

To publish this release:
  git push && git push --tags
```
