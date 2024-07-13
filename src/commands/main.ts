import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand } from "../definitions";
import { commitChanges, getGitBranch, getGitChanges } from "../utils/git";
import config from "../utils/config";
import { AIBuilder, providers } from "../utils/ai";
import { copyToClipboard } from "../utils";

const MainCommand: ICommand = {
  name: "generate",
  default: true,
  description: "Generate a commit message based on the changes in the staging area",
  action: async () => {
    const spinner = ora('').start();
    const branch = await getGitBranch();
    const changes = await getGitChanges();

    if (changes.length === 0) {
      spinner.fail(chalk.red("No changes found. Please make some changes to your code and add them to the staging area."));
      return;
    }

    const allKeys = config.getAllKeys();
    // search for the first provider with an API key
    const selectedProvider = providers.find(p => allKeys[p.value]);

    if (!selectedProvider) {
      spinner.fail(chalk.red("No API keys found. Please run `gsmart login` to paste your API key."));
      return;
    }

    const ai = new AIBuilder(selectedProvider.value);
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
        { title: "Do nothing", value: "nothing" },
      ]
    });

    if (!action) {
      ora().fail(chalk.red("No action selected. Doing nothing."));
      return;
    }

    switch (action) {
      case "commit":
        await commitChanges(message);
        ora().succeed(chalk.green("Changes committed successfully"));
        break;
      case "copy":
        await copyToClipboard(message);
        ora().succeed(chalk.green("Message copied to clipboard"));
        break;
      case "nothing":
        ora().succeed(chalk.yellow("No action taken"));
        break;
    }
  }
}

export default MainCommand;
