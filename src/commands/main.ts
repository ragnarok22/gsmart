import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand, IProvider } from "../definitions";
import { commitChanges, getGitBranch, parseDiffFileNames } from "../utils/git";
import config from "../utils/config";
import { AIBuilder } from "../utils/ai";
import { getActiveProviders } from "../utils/providers";
import { copyToClipboard, retrieveFilesToCommit } from "../utils";
import { debugLog, debugTime } from "../utils/debug";

type MainCommandOptions = {
  prompt?: string;
  provider?: string;
  yes?: boolean;
  dryRun?: boolean;
};

type MainCommandDeps = {
  spinner: typeof ora;
  prompt: typeof prompts;
  config: typeof config;
  AIBuilder: typeof AIBuilder;
  getActiveProviders: typeof getActiveProviders;
  retrieveFilesToCommit: typeof retrieveFilesToCommit;
  getGitBranch: typeof getGitBranch;
  commitChanges: typeof commitChanges;
  copyToClipboard: typeof copyToClipboard;
  parseDiffFileNames: typeof parseDiffFileNames;
  debugLog: typeof debugLog;
  debugTime: typeof debugTime;
  log: typeof console.log;
};

const defaultDeps: MainCommandDeps = {
  spinner: ora,
  prompt: prompts,
  config,
  AIBuilder,
  getActiveProviders,
  retrieveFilesToCommit,
  getGitBranch,
  commitChanges,
  copyToClipboard,
  parseDiffFileNames,
  debugLog,
  debugTime,
  log: console.log,
};

const getProvider = async (
  provider: string,
  skipPrompt = false,
  deps: MainCommandDeps = defaultDeps,
): Promise<IProvider | null> => {
  const allKeys = deps.config.getAllKeys();
  const activeProviders = deps
    .getActiveProviders()
    .filter((p) => allKeys[p.value]);

  if (provider) {
    const selectedProvider = activeProviders.find((p) => p.value === provider);
    if (!selectedProvider) {
      return null;
    }
    return selectedProvider;
  }

  if (activeProviders.length === 0) {
    return null;
  }

  if (activeProviders.length === 1) {
    return activeProviders[0];
  }

  if (skipPrompt) {
    // When skip prompt is enabled, use the first available provider
    return activeProviders[0];
  }

  const { value } = await deps.prompt({
    type: "select",
    name: "value",
    message: "Select an AI provider",
    choices: activeProviders.map((p) => ({ title: p.title, value: p.value })),
  });
  const selectedProvider =
    activeProviders.find((p) => p.value === value) || null;
  return selectedProvider;
};

const mainAction = async (
  options: MainCommandOptions = {},
  deps: MainCommandDeps = defaultDeps,
  command?: ICommand,
) => {
  const spinner = deps.spinner("").start();
  const changes = await deps.retrieveFilesToCommit(spinner, {
    autoStage: Boolean(options.yes),
    dryRun: Boolean(options.dryRun),
  });
  const branch = await deps.getGitBranch();

  if (!changes) {
    spinner.stop();
    return;
  }

  const selectedProvider = await getProvider(
    options.provider ?? "",
    Boolean(options.yes),
    deps,
  );

  if (!selectedProvider && !options.provider) {
    spinner.fail(
      chalk.red(
        "No API keys found. Please run `gsmart login` to paste your API key.",
      ),
    );
    return;
  } else if (!selectedProvider) {
    spinner.fail(
      chalk.red("No valid provider found. Please check your API keys."),
    );
    return;
  }

  deps.debugLog("generate", `provider: ${selectedProvider.title}`);
  deps.debugLog("generate", `branch: ${branch}`);

  if (options.provider) {
    spinner.info(chalk.green(`Using provider: ${selectedProvider.title}`));
  }

  if (!spinner.isSpinning) spinner.start();

  const prompt = options.prompt || deps.config.getPrompt() || "";
  const ai = new deps.AIBuilder(selectedProvider.value, prompt);
  const stopTimer = deps.debugTime("generate");
  const message = await ai.generateCommitMessage(branch, changes, {
    onRetry: (attempt, maxRetries) => {
      spinner.text = chalk.yellow(
        `Retrying... (attempt ${attempt + 1}/${maxRetries})`,
      );
    },
  });
  stopTimer();
  if (typeof message === "object") {
    spinner.fail(chalk.red(message.error));
    return;
  }
  spinner.succeed(chalk.green(message));

  if (options.dryRun) {
    const fileNames = deps.parseDiffFileNames(changes);
    if (fileNames.length > 0) {
      deps.log(chalk.cyan("\nStaged files:"));
      for (const file of fileNames) {
        deps.log(chalk.grey(`  ${file}`));
      }
    }
    return;
  }

  let action = "commit";

  if (!options.yes) {
    const response = await deps.prompt({
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { title: "Commit", value: "commit" },
        { title: "Copy message to clipboard", value: "copy" },
        { title: "Regenerate message", value: "regenerate" },
        { title: "Do nothing", value: "nothing" },
      ],
    });

    if (!response.action) {
      deps.spinner().fail(chalk.red("No action selected. Doing nothing."));
      return;
    }

    action = response.action;
  }

  switch (action) {
    case "commit": {
      const result = await deps.commitChanges(message);
      if (result) {
        deps.spinner().succeed(chalk.green("Changes committed successfully"));
      } else {
        deps.spinner().fail(chalk.red("Failed to commit changes."));
        const fallback = await deps.copyToClipboard(message);
        if (fallback) {
          deps.spinner().succeed(chalk.green("Message copied to clipboard"));
        } else {
          deps
            .spinner()
            .warn(chalk.yellow("Could not copy message to clipboard"));
          deps.log(message);
        }
      }
      break;
    }
    case "copy":
      {
        const copied = await deps.copyToClipboard(message);
        if (copied) {
          deps.spinner().succeed(chalk.green("Message copied to clipboard"));
        } else {
          deps
            .spinner()
            .warn(chalk.yellow("Could not copy message to clipboard"));
          deps.log(message);
        }
      }
      break;
    case "regenerate":
      spinner.stop();
      await (command ?? MainCommand).action(options);
      return;
    case "nothing":
      deps.spinner().succeed(chalk.yellow("No action taken"));
      break;
  }

  spinner.stop();
};

export const createMainCommand = (
  deps: Partial<MainCommandDeps> = {},
): ICommand => {
  const services = { ...defaultDeps, ...deps };
  const command: ICommand = {
    name: "generate",
    default: true,
    description:
      "Generate a commit message based on the changes in the staging area",
    options: [
      {
        flags: "-p, --prompt <prompt>",
        default: "",
        description: "The prompt to use for generating the commit message",
      },
      {
        flags: "-P, --provider <provider>",
        default: "",
        description: "The AI provider to use for generating the commit message",
      },
      {
        flags: "-y, --yes",
        default: false,
        description:
          "Automatically commit without prompting (useful for automation)",
      },
      {
        flags: "-d, --dry-run",
        default: false,
        description:
          "Show the generated commit message and staged files without committing",
      },
    ],
    action: (options) =>
      mainAction(options as MainCommandOptions, services, command),
  };

  return command;
};

const MainCommand = createMainCommand();

export default MainCommand;
