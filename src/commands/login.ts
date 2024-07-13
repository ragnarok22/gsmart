import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand } from "../definitions";
import { providers } from "../utils/ai";
import config from "../utils/config";

/**
 * Login command to paste the API key
**/
const LoginCommand: ICommand = {
  name: "login",
  description: "Login to a provider to use their AI service",
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

    if (!provider) {
      ora().fail(chalk.red("No provider selected"));
      return;
    }

    const { key } = await prompts({
      type: "password",
      name: "key",
      message: "Enter your API key",
      hint: "This will be stored in your local configuration",
    })

    if (!key) {
      ora().fail(chalk.red("No API key provided"));
      return;
    }

    config.setKey(provider, key)
    ora().succeed(chalk.green("API key saved successfully"));
  }
}

export default LoginCommand;
