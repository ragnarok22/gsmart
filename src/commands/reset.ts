import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand } from "../definitions";
import config from "../utils/config";

const ResetCommand: ICommand = {
  name: "reset",
  options: [{ flags: "-f, --force", description: "Force reset the configuration" }],
  description: "Reset the API key for all providers and remove the configuration file",
  action: async (options) => {
    if (!options.force) {
      const { confirm } = await prompts({
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to reset the configuration?",
      });

      if (!confirm) {
        ora().fail(chalk.red("Operation cancelled"));
        return;
      }
    }

    config.clear();
    ora().succeed(chalk.green("Configuration reset successfully"));
  }
}

export default ResetCommand;
