# GSmart
The smart way to write your commit messages using [Conventional Commits](https://www.conventionalcommits.org/).

![NPM Downloads](https://img.shields.io/npm/dm/gsmart)
![NPM Version](https://img.shields.io/npm/v/gsmart)
![NPM License](https://img.shields.io/npm/l/gsmart)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/gsmart)
![NPM Unpacked Size](https://img.shields.io/npm/unpacked-size/gsmart)
![NPM Type Definitions](https://img.shields.io/npm/types/gsmart)

![GSmart image](https://repository-images.githubusercontent.com/827045490/756cb1d5-9572-4cc2-be37-0459da007c1a)

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

### Generate options
If can add different providers. If you want to use a specific provider, you can use the `--provider` option.
```bash
gsmart --provider anthropic
```

You can also specify the prompt to use for the AI model, using the `--prompt` option.
```bash
gsmart --prompt "Explaining the changes in the staging area"
```


```
Usage: gsmart [options] [command]

CLI to generate smart commit messages using AI. generate command is the default command.

Options:
-V, --version   output the version number
-h, --help      display help for command

Commands:
generate        Generate a commit message based on the changes in the staging area
login           Login to a provider to use their AI service
reset           Reset the API key for all providers and remove the configuration file
help [command]  Display help for command
```

## Providers
- [OpenAI](https://openai.com/)
  - Model: [GPT-4o](https://platform.openai.com/docs/models/gpt-4o)
  - [Get API Key](https://platform.openai.com/api-keys)
- [Anthropic](https://www.anthropic.com/)
  - Model: [Claude](https://www.anthropic.com/claude)
  - [Get API Key](https://console.anthropic.com/settings/keys)
- [Mistral](https://www.mistral.ai/)
  - Model: [Mistral Large](https://mistral.ai/technology/#models)
  - [Get API Key](https://console.mistral.ai/api-keys/)
- [Fireworks AI](https://fireworks.ai)
  - Model: [FireFunction V1](https://fireworks.ai/models/fireworks/firefunction-v1)
  - [Get API Key](https://fireworks.ai/api-keys)
- [PlataformIA](https://plataformia.com)
  - Model: [Radiance](https://docs.plataformia.com/llm-chat-api)
  - [Get API Key](https://console.plataformia.com/api-keys)

## License
This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
