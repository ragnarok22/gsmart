import chalk from "chalk";
import ora from "ora";
import { ICommand } from "../definitions";
import config from "../utils/config";

const ResetCommand: ICommand = {
  name: "reset",
  description: "Reset the API key for a provider and remove the configuration",
  action: async () => {
    config.clear();
    ora().succeed(chalk.green("Configuration reset successfully"));
  }
}

export default ResetCommand;
