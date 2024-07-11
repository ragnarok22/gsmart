import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand } from "./definitions";
import { commitChanges, getGitBranch, getGitChanges } from "./utils/git";
import { providers } from "./utils/ai";
import config from "./utils/config";
import { AIBuilder } from "./utils/ai";
import { copyToClipboard } from "./utils";

const MainCommand: ICommand = {
  name: "gsmart",
  default: true,
  description: "Get the current git branch",
  action: async () => {
    const spinner = ora('').start();
    const branch = await getGitBranch();
    const changes = await getGitChanges();

    if (changes.length === 0) {
      spinner.fail(chalk.red("No changes found. Please make some changes to your code and add them to the staging area."));
      return;
    }

    const allKeys = config.getAllKeys();
    if (!allKeys.openai && !allKeys.anthropic) {
      spinner.fail(chalk.red("No API keys found. Please run `gsmart login` to paste your API key."));
      return;
    }

    const selectedProvider = allKeys.openai ? "openai" : "anthropic";
    const ai = new AIBuilder(selectedProvider);
    const message = await ai.generateCommitMessage(branch, changes);
    if (typeof message === "object") {
      spinner.fail(chalk.red(message.error));
      return;
    }
    spinner.succeed(chalk.green(message));

    const { action } = await prompts({
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { title: "Commit", value: "commit" },
        { title: "Copy message to clipboard", value: "copy" },
      ]
    });

    switch (action) {
      case "commit":
        await commitChanges(message);
        console.log(chalk.green("Changes committed successfully"));
        break;
      case "copy":
        await copyToClipboard(message);
        console.log(chalk.green("Message copied to clipboard"));
        break;
    }
  }
}

/**
 * Login command to paste the API key
**/
const LoginCommand: ICommand = {
  name: "login",
  description: "",
  action: async () => {
    const { provider } = await prompts({
      type: "select",
      name: "provider",
      message: "Select a provider",
      hint: "Use arrow keys to navigate",
      choices: providers.filter(p => p.active).map(p => ({
        title: p.title,
        value: p.value
      }))
    });

    const { key } = await prompts({
      type: "password",
      name: "key",
      message: "Enter your API key",
      hint: "This will be stored in your local configuration",
    })

    switch (provider) {
      case "openai":
        config.setOpenAIKey(key);
        break;
      case "anthropic":
        config.setAnthropicKey(key);
        break;
    }
  }
}

export default [MainCommand, LoginCommand];
