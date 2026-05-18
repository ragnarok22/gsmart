import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand, IProvider } from "../definitions";
import { providers as providerDefinitions } from "../utils/providers";
import config from "../utils/config";
import { loginWithOpenAIOAuth, OpenAIOAuthTokens } from "../utils/openai-oauth";

type LoginConfig = {
  setKey(provider: string, key: string): void;
  setOpenAIAuthMode(mode: "api-key" | "oauth"): void;
  setOpenAIOAuthTokens(tokens: OpenAIOAuthTokens): void;
};

type LoginCommandDeps = {
  prompt: typeof prompts;
  spinner: typeof ora;
  providers: IProvider[];
  config: LoginConfig;
  loginWithOpenAIOAuth: typeof loginWithOpenAIOAuth;
};

const defaultDeps: LoginCommandDeps = {
  prompt: prompts,
  spinner: ora,
  providers: providerDefinitions,
  config,
  loginWithOpenAIOAuth,
};

/**
 * Login command to paste the API key
 **/
export const createLoginCommand = (
  deps: Partial<LoginCommandDeps> = {},
): ICommand => {
  const services = { ...defaultDeps, ...deps };

  return {
    name: "login",
    description: "Login to a provider to use their AI service",
    action: async () => {
      const { provider } = await services.prompt({
        type: "select",
        name: "provider",
        message: "Select a provider",
        hint: "Use arrow keys to navigate",
        choices: services.providers
          .filter((p) => p.active)
          .map((p) => ({
            title: p.title,
            value: p.value,
          })),
      });

      if (!provider) {
        services.spinner().fail(chalk.red("No provider selected"));
        return;
      }

      if (provider === "openai") {
        const { authMethod } = await services.prompt({
          type: "select",
          name: "authMethod",
          message: "How would you like to authenticate with OpenAI?",
          choices: [
            { title: "ChatGPT subscription", value: "oauth" },
            { title: "API key", value: "api-key" },
          ],
        });

        if (!authMethod) {
          services
            .spinner()
            .fail(chalk.red("No authentication method selected"));
          return;
        }

        if (authMethod === "oauth") {
          const spinner = services
            .spinner("Waiting for ChatGPT authorization")
            .start();
          try {
            const tokens = await services.loginWithOpenAIOAuth();
            services.config.setOpenAIOAuthTokens(tokens);
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

      const { key } = await services.prompt({
        type: "password",
        name: "key",
        message: "Enter your API key",
        hint: "This will be stored in your local configuration",
      });

      if (!key) {
        services.spinner().fail(chalk.red("No API key provided"));
        return;
      }

      services.config.setKey(provider, key);
      if (provider === "openai") {
        services.config.setOpenAIAuthMode("api-key");
      }
      services.spinner().succeed(chalk.green("API key saved successfully"));
    },
  };
};

const LoginCommand = createLoginCommand();

export default LoginCommand;
