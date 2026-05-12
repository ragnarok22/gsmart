import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand } from "../definitions";
import { providers } from "../utils/providers";
import config from "../utils/config";
import { loginWithOpenAIOAuth } from "../utils/openai-oauth";

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
      choices: providers
        .filter((p) => p.active)
        .map((p) => ({
          title: p.title,
          value: p.value,
        })),
    });

    if (!provider) {
      ora().fail(chalk.red("No provider selected"));
      return;
    }

    if (provider === "openai") {
      const { authMethod } = await prompts({
        type: "select",
        name: "authMethod",
        message: "How would you like to authenticate with OpenAI?",
        choices: [
          { title: "ChatGPT subscription", value: "oauth" },
          { title: "API key", value: "api-key" },
        ],
      });

      if (!authMethod) {
        ora().fail(chalk.red("No authentication method selected"));
        return;
      }

      if (authMethod === "oauth") {
        const spinner = ora("Waiting for ChatGPT authorization").start();
        try {
          const tokens = await loginWithOpenAIOAuth();
          config.setOpenAIOAuthTokens(tokens);
          spinner.succeed(chalk.green("ChatGPT login saved successfully"));
        } catch (error) {
          spinner.fail(
            chalk.red(
              error instanceof Error ? error.message : "ChatGPT login failed",
            ),
          );
        }
        return;
      }
    }

    const { key } = await prompts({
      type: "password",
      name: "key",
      message: "Enter your API key",
      hint: "This will be stored in your local configuration",
    });

    if (!key) {
      ora().fail(chalk.red("No API key provided"));
      return;
    }

    config.setKey(provider, key);
    if (provider === "openai") {
      config.setOpenAIAuthMode("api-key");
    }
    ora().succeed(chalk.green("API key saved successfully"));
  },
};

export default LoginCommand;
