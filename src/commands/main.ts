import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand, IProvider } from "../definitions";
import { commitChanges, getGitBranch } from "../utils/git";
import config from "../utils/config";
import { AIBuilder, getActiveProviders } from "../utils/ai";
import { copyToClipboard, retrieveFilesToCommit } from "../utils";

const providers = getActiveProviders();

const getProvider = async (provider: string): Promise<IProvider | null> => {
  const allKeys = config.getAllKeys();
  const activeProviders = providers.filter(p => allKeys[p.value]);

  if (provider) {
    const selectedProvider = activeProviders.find(p => p.value === provider);
    if (!selectedProvider) {
      return null;
    }
    return selectedProvider;
  }

  if (!activeProviders) {
    return null;
  }

  if (activeProviders.length === 1) {
    return activeProviders[0];
  }

  const { value } = await prompts({
    type: "select",
    name: "value",
    message: "Select an AI provider",
    choices: activeProviders.map(p => ({ title: p.title, value: p.value })),
  });
  const selectedProvider = activeProviders.find(p => p.value === value) || null;
  return selectedProvider;
}

const mainAction = async (options) => {
  const spinner = ora('').start();
  const changes = await retrieveFilesToCommit(spinner);
  const branch = await getGitBranch();

  if (!changes) {
    spinner.stop();
    return;
  }

  const selectedProvider = await getProvider(options.provider);

  if (!selectedProvider && !options.provider) {
    spinner.fail(chalk.red("No API keys found. Please run `gsmart login` to paste your API key."));
    return;
  } else if (!selectedProvider) {
    spinner.fail(chalk.red("No valid provider found. Please check your API keys."));
    return;
  }

  if (options.provider) {
    spinner.info(chalk.green(`Using provider: ${selectedProvider.title}`));
  }

  if (!spinner.isSpinning)
    spinner.start();

  const ai = new AIBuilder(selectedProvider.value, options.prompt)
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
      { title: "Regenerate message", value: "regenerate" },
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
    case "regenerate":
      MainCommand.action(options);
      break;
    case "nothing":
      ora().succeed(chalk.yellow("No action taken"));
      break;
  }

  spinner.stop();
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
  action: mainAction,
}

export default MainCommand;
