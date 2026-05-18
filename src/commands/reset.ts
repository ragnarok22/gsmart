import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand } from "../definitions";
import config from "../utils/config";

type ResetOptions = {
  force?: boolean;
};

type PromptFn = (question: Parameters<typeof prompts>[0]) => Promise<{
  [key: string]: unknown;
}>;

type ResetCommandDeps = {
  prompt: PromptFn;
  spinner: typeof ora;
  config: Pick<typeof config, "clear">;
};

const defaultDeps: ResetCommandDeps = {
  prompt: prompts,
  spinner: ora,
  config,
};

const resetAction = async (
  options: ResetOptions = {},
  deps: ResetCommandDeps = defaultDeps,
) => {
  if (!options.force) {
    const { confirm } = (await deps.prompt({
      type: "confirm",
      name: "confirm",
      message: "Are you sure you want to reset the configuration?",
    })) as { confirm?: boolean };

    if (!confirm) {
      deps.spinner().fail(chalk.red("Operation cancelled"));
      return;
    }
  }

  deps.config.clear();
  deps.spinner().succeed(chalk.green("Configuration reset successfully"));
};

export const createResetCommand = (
  deps: Partial<ResetCommandDeps> = {},
): ICommand => {
  const services = { ...defaultDeps, ...deps };

  return {
    name: "reset",
    options: [
      { flags: "-f, --force", description: "Force reset the configuration" },
    ],
    description:
      "Reset the API key for all providers and remove the configuration file",
    action: (options) => resetAction(options as ResetOptions, services),
  };
};

const ResetCommand = createResetCommand();

export default ResetCommand;
