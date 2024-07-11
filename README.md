# GSmart
The smart way to write your commit messages using [Conventional Commits](https://www.conventionalcommits.org/).

## Installation
```bash
npm install -g gsmart
```

## Usage
After installing the package, you can use the `gsmart` command to write your commit messages.
First you need to provide your API key for any of the supported AI services. You can use the `gsmart login` command to do this.
```bash
gsmart login
? Select a provider > suse arrow keys to navigate
❯ OpenAI
  Anthropic
```

After selecting a provider, you will be prompted to enter your API key.
```bash
? Enter your API key:
```

To generate a commit message, you need to be in a git repository and have some changes to commit.
Add the changes to the staging area using the `git add` command. Then you can use the `gsmart` command to write your commit message.
```bash
gsmart
```

```
Usage: gsmart [options] [command]

CLI to generate smart commit messages using AI.

Options:
-V, --version   output the version number
-h, --help      display help for command

Commands:
generate        Generate a commit message based on the changes in the staging area
login           Login to a provider to use their AI service
help [command]  Display help for command
```

