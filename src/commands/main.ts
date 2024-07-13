import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand, IProvider } from "../definitions";
import { commitChanges, getGitBranch, getGitChanges } from "../utils/git";
import config from "../utils/config";
import { AIBuilder, getActiveProviders } from "../utils/ai";
import { copyToClipboard } from "../utils";

const providers = getActiveProviders();

const getGitInfo = async (): Promise<[string, string]> => {
  const branch = await getGitBranch();
  const changes = await getGitChanges();
  return [branch, changes];
}

const getProvider = async (provider: string): Promise<IProvider | null> => {
  const allKeys = config.getAllKeys();

  if (provider) {
    const selectedProvider = providers.find(p => p.value === provider);
    if (!selectedProvider) {
      return null;
    }
    return selectedProvider;
  }

  const providersKeys = providers.filter(p => allKeys[p.value]);

  if (!providersKeys) {
    return null;
  }

  if (providersKeys.length === 1) {
    return providersKeys[0];
  }

  const { value } = await prompts({
    type: "select",
    name: "value",
    message: "Select an AI provider",
    choices: providersKeys.map(p => ({ title: p.title, value: p.value })),
  });
  return value;
}

const MainCommand: ICommand = {
  name: "generate",
  default: true,
  description: "Generate a commit message based on the changes in the staging area",
  options: [{
    flags: "-p, --prompt <prompt>",
    default: "",
    description: "The prompt to use for generating the commit message",
  }, {
    flags: "-P, --provider <provider>",
    default: "",
    description: "The AI provider to use for generating the commit message",
  }],
  action: async (options) => {
    const spinner = ora('').start();
    const [branch, changes] = await getGitInfo();

    if (changes.length === 0) {
      spinner.fail(chalk.red("No changes found. Please make some changes to your code and add them to the staging area."));
      return;
    }

    const selectedProvider = await getProvider(options.provider);

    if (!selectedProvider) {
      spinner.fail(chalk.red("No API keys found. Please run `gsmart login` to paste your API key."));
      return;
    }

    if (options.provider) {
      spinner.info(chalk.green(`Using provider: ${selectedProvider.title}`));
    }

    const ai = new AIBuilder(selectedProvider.value)
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
        const result = await commitChanges(message);
        if (result) {
          ora().succeed(chalk.green("Changes committed successfully"));
        } else {
          ora().fail(chalk.red("Failed to commit changes."));
          await copyToClipboard(message);
          ora().succeed(chalk.green("Message copied to clipboard"));
        }
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
