import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand, IProvider, StatusFile } from "../definitions";
import { commitChanges, getGitBranch, getGitChanges, getGitStatus, stageFile } from "../utils/git";
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
      // get modified files that are not staged
      const status = await getGitStatus();

      if (status.length === 0) {
        spinner.fail(chalk.red("No changes found. Please make some changes to your code and add them to the staging area."));
        return;
      }
      spinner.stop();

      const changedFiles = status.map((file) => {
        console.log(file)
        if (file.status === StatusFile.Modified) {
          return {
            title: chalk.yellow(file.file_name),
            value: file.file_name,
          };
        } else if (file.status === StatusFile.Deleted) {
          return {
            title: chalk.red(file.file_name),
            value: file.file_name,
          }
        } else if (file.status === StatusFile.Untracked) {
          return {
            title: chalk.green(file.file_name),
            value: file.file_name,
          }
        } else {
          return {
            title: file.file_name,
            value: file.file_name,
          };
        }
      });

      const { files } = await prompts({
        type: "multiselect",
        name: "files",
        message: "Select files to stage",
        choices: changedFiles.map((file) => ({
          title: file.title,
          value: file.value,
        })),
      });

      if (files.length === 0) {
        spinner.fail(chalk.red("No files selected. Please select files to stage."));
        return;
      }

      const result = await stageFile(files);
      if (result) {
        spinner.succeed(chalk.grey("Files staged successfully"));
      } else {
        spinner.fail(chalk.red("Failed to stage files"));
        return;
      }
    }
    spinner.start();

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
}

export default MainCommand;
