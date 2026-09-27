import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand } from "../definitions";
import config from "../utils/config";
import {
  providers,
  validateProvider,
  validateModel,
  validateBaseURL,
  resolveModel,
} from "../utils/providers";
import { usesOpenAIOAuth } from "../utils/provider-config";
import { configureCustomEndpoint } from "../utils/custom-endpoint";
import { setPrompt, getPrompt, clearPrompt } from "../utils/prompt-config";
import { loadEffectiveConventions } from "../utils/repository-config";
import { contextOptions } from "../utils/context-options";
import {
  conventionsFromOptions,
  type ConventionOptions,
} from "../utils/conventions";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export const readPromptInput = (
  message: string,
  initial: string = "",
): Promise<string | null> => {
  return new Promise((resolve) => {
    const supportsRawMode =
      process.stdin.isTTY && typeof process.stdin.setRawMode === "function";

    if (!supportsRawMode) {
      console.log(
        chalk.yellow(
          'Interactive prompt input is unavailable in this environment. Use --add-custom-prompt "..." to set a default prompt non-interactively.',
        ),
      );
      resolve(initial.trim() || null);
      return;
    }

    let buffer = initial;
    let isPasted = !!initial;
    let inBracketedPaste = false;
    let pasteAccumulator = "";

    const lineCount = (s: string) =>
      s.split("\n").filter((l) => l.trim()).length;

    const render = () => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`? ${chalk.bold(message)} › `);
      if (isPasted && buffer) {
        const n = lineCount(buffer);
        process.stdout.write(
          chalk.cyan(`Pasted text +${n} lines `) +
            chalk.dim("(Enter to confirm, Ctrl+C to cancel)"),
        );
      } else {
        process.stdout.write(buffer);
      }
    };

    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeAllListeners("data");
      process.stdin.pause();
    };

    process.stdin.on("data", (data: string) => {
      // Bracketed paste start
      if (data.includes(PASTE_START)) {
        inBracketedPaste = true;
        pasteAccumulator = "";
        const afterStart = data.slice(
          data.indexOf(PASTE_START) + PASTE_START.length,
        );
        if (afterStart.includes(PASTE_END)) {
          const content = afterStart.slice(0, afterStart.indexOf(PASTE_END));
          inBracketedPaste = false;
          const normalized = content
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trimEnd();
          buffer = normalized;
          isPasted = true;
          render();
        } else {
          pasteAccumulator += afterStart;
        }
        return;
      }

      // Bracketed paste end
      if (inBracketedPaste) {
        if (data.includes(PASTE_END)) {
          pasteAccumulator += data.slice(0, data.indexOf(PASTE_END));
          inBracketedPaste = false;
          const normalized = pasteAccumulator
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trimEnd();
          buffer = normalized;
          isPasted = true;
          render();
        } else {
          pasteAccumulator += data;
        }
        return;
      }

      if (data === "\x03") {
        cleanup();
        process.stdout.write("\n");
        resolve(null);
        return;
      }

      if (data === "\r" || data === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(buffer.trim() || null);
        return;
      }

      if (data === "\x7f") {
        if (!isPasted && buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          process.stdout.write("\b \b");
        } else if (isPasted) {
          buffer = "";
          isPasted = false;
          render();
        }
        return;
      }

      // Regular typing or non-bracketed paste fallback
      const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (normalized.includes("\n") || data.length > 3) {
        // Append instead of overwrite so multi-chunk pastes accumulate correctly
        buffer += normalized;
        isPasted = true;
        render();
      } else {
        isPasted = false;
        buffer += data;
        process.stdout.write(data);
      }
    });
  });
};

type ConfigOptions = ConventionOptions & {
  show?: boolean;
  showEffective?: boolean;
  addCustomPrompt?: string;
  clearCustomPrompt?: boolean;
  provider?: string;
  defaultProvider?: string;
  clearDefaultProvider?: boolean;
  model?: string;
  clearModel?: boolean;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  clearCustomEndpoint?: boolean;
};

type PromptConfig = {
  setPrompt(prompt: string): void;
  getPrompt(): string;
  clearPrompt(): { cleared: boolean };
};

type PromptFn = (question: Parameters<typeof prompts>[0]) => Promise<{
  [key: string]: unknown;
}>;

type ConfigCommandDeps = {
  prompt: PromptFn;
  spinner: typeof ora;
  promptConfig: PromptConfig;
  readPromptInput: typeof readPromptInput;
  loadEffectiveConventions: typeof loadEffectiveConventions;
  log: typeof console.log;
  config: typeof config;
  setExitCode: (code: number) => void;
};

const defaultDeps: ConfigCommandDeps = {
  prompt: prompts,
  spinner: ora,
  promptConfig: { setPrompt, getPrompt, clearPrompt },
  readPromptInput,
  loadEffectiveConventions,
  log: console.log,
  config,
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

const displayProviderConfig = (deps: ConfigCommandDeps) => {
  const store = deps.config.getProviderSnapshot?.() ?? deps.config;
  deps.log(
    `Default provider: ${store.getDefaultProvider() ?? "automatic selection"}`,
  );
  for (const provider of providers) {
    const saved = store.getModel(provider.value);
    const oauth = provider.value === "openai" && usesOpenAIOAuth(store);
    const model =
      saved ||
      (provider.value === "custom"
        ? "not configured"
        : resolveModel(provider.value, undefined, undefined, oauth));
    const authentication =
      provider.value === "custom"
        ? store.getKey("custom")
          ? "API key configured"
          : "none"
        : oauth
          ? "ChatGPT OAuth"
          : store.getKey(provider.value)
            ? "API key configured"
            : "not configured";
    deps.log(
      `${provider.value}: model=${model} (${saved ? "saved" : provider.value === "custom" ? "required" : "built-in"}); authentication=${authentication}`,
    );
    if (provider.value === "custom")
      deps.log(
        `  Endpoint: ${store.getCustomBaseURL() || "not configured"}; API: Chat Completions`,
      );
  }
};

const hasProviderOptions = (options: ConfigOptions): boolean =>
  [
    "provider",
    "defaultProvider",
    "clearDefaultProvider",
    "model",
    "clearModel",
    "baseUrl",
    "apiKey",
    "clearApiKey",
    "clearCustomEndpoint",
  ].some((key) => options[key as keyof ConfigOptions] !== undefined);

const updateProviderConfig = (
  options: ConfigOptions,
  store: typeof config,
): boolean => {
  if (!hasProviderOptions(options)) return false;

  for (const [set, clear] of [
    ["defaultProvider", "clearDefaultProvider"],
    ["model", "clearModel"],
    ["apiKey", "clearApiKey"],
  ] as const) {
    if (options[set] !== undefined && options[clear])
      throw new Error(`Cannot set and clear ${set} in the same command.`);
  }
  const provider =
    options.provider !== undefined
      ? validateProvider(options.provider)
      : undefined;
  const defaultProvider =
    options.defaultProvider !== undefined
      ? validateProvider(options.defaultProvider)
      : undefined;
  const model =
    options.model !== undefined ? validateModel(options.model) : undefined;
  const baseURL =
    options.baseUrl !== undefined
      ? validateBaseURL(options.baseUrl)
      : undefined;
  const endpointOptions =
    baseURL !== undefined ||
    options.apiKey !== undefined ||
    options.clearApiKey;
  if (
    (model !== undefined || options.clearModel || endpointOptions) &&
    !provider
  )
    throw new Error(
      "Specify --provider <provider> when changing a model or endpoint.",
    );
  if (endpointOptions && provider !== "custom")
    throw new Error(
      "Endpoint and API-key settings require --provider custom. Use `gsmart login` for hosted providers.",
    );
  if (options.apiKey !== undefined && !options.apiKey.trim())
    throw new Error(
      "Use --clear-api-key to remove custom endpoint authentication.",
    );
  if (
    options.clearCustomEndpoint &&
    (endpointOptions ||
      model !== undefined ||
      options.clearModel ||
      defaultProvider === "custom")
  )
    throw new Error(
      "Cannot clear and configure the custom endpoint in the same command.",
    );
  if (
    provider &&
    model === undefined &&
    !options.clearModel &&
    !endpointOptions &&
    !options.clearCustomEndpoint &&
    !defaultProvider &&
    !options.clearDefaultProvider &&
    !options.show
  )
    throw new Error(
      "Use --model <model>, --clear-model, or --base-url <url> with --provider.",
    );

  // All arguments have been validated before any setting is written.
  if (defaultProvider) store.setDefaultProvider(defaultProvider);
  if (options.clearDefaultProvider) store.clearDefaultProvider();
  if (provider && model !== undefined) store.setModel(provider, model);
  if (provider && options.clearModel) store.clearModel(provider);
  if (baseURL !== undefined) store.setCustomBaseURL(baseURL);
  if (options.apiKey !== undefined)
    store.setKey("custom", options.apiKey.trim());
  if (options.clearApiKey) store.clearKey("custom");
  if (options.clearCustomEndpoint) store.clearCustomEndpoint();
  return true;
};

const displayPrompt = (
  savedPrompt: string,
  log: typeof console.log,
  prefix: string = "",
) => {
  if (savedPrompt) {
    log(chalk.bold(`${prefix}Default prompt:`));
    log(chalk.cyan(savedPrompt));
  } else {
    log(chalk.yellow(`${prefix}No default prompt configured.`));
  }
};

const configAction = async (
  options: ConfigOptions = {},
  deps: ConfigCommandDeps = defaultDeps,
) => {
  const hasPromptOptions =
    options.addCustomPrompt !== undefined || options.clearCustomPrompt;
  if (
    !options.showEffective &&
    (options.contextBudget !== undefined ||
      options.contextExclude !== undefined ||
      options.summarize !== undefined)
  )
    throw new Error(
      "Use context overrides with config --show-effective to inspect them. Save shared context settings in .gsmartrc.json.",
    );
  if (options.addCustomPrompt !== undefined && options.clearCustomPrompt)
    throw new Error(
      "Cannot set and clear the default prompt in the same command.",
    );
  if (options.showEffective) {
    if (hasProviderOptions(options) || hasPromptOptions)
      throw new Error(
        "--show-effective cannot be combined with provider or prompt updates. Save the settings first, then inspect the effective conventions.",
      );
    const savedPrompt = deps.promptConfig.getPrompt();
    const effective = await deps.loadEffectiveConventions({
      user: savedPrompt ? { instructions: savedPrompt } : {},
      cli: conventionsFromOptions(options),
    });
    deps.log(JSON.stringify(effective, null, 2));
    return;
  }
  const providerUpdated = updateProviderConfig(options, deps.config);
  if (providerUpdated) {
    deps.spinner().succeed(chalk.green("Provider preferences saved"));
  }
  if (options.addCustomPrompt !== undefined) {
    deps.promptConfig.setPrompt(options.addCustomPrompt);
    deps.spinner().succeed(chalk.green("Default prompt saved successfully"));
  } else if (options.clearCustomPrompt) {
    const { cleared } = deps.promptConfig.clearPrompt();
    if (!cleared) {
      deps.spinner().warn(chalk.yellow("No default prompt to clear"));
    } else {
      deps.spinner().succeed(chalk.green("Default prompt cleared"));
    }
  }

  if (options.show) {
    displayPrompt(deps.promptConfig.getPrompt(), deps.log);
    displayProviderConfig(deps);
    return;
  }
  if (providerUpdated || hasPromptOptions) return;

  const { action } = (await deps.prompt({
    type: "select",
    name: "action",
    message: "What would you like to configure?",
    choices: [
      { title: "Set default prompt (commit style)", value: "set" },
      { title: "Show current configuration", value: "show" },
      { title: "Clear default prompt", value: "clear" },
      { title: "Set default provider", value: "provider" },
      { title: "Set preferred model", value: "model" },
      { title: "Configure custom / local endpoint", value: "endpoint" },
    ],
  })) as { action?: string };

  if (!action) {
    deps.spinner().fail(chalk.red("No option selected"));
    return;
  }

  switch (action) {
    case "provider": {
      const { provider } = await deps.prompt({
        type: "select",
        name: "provider",
        message: "Default AI provider",
        choices: [
          { title: "Automatic selection", value: "" },
          ...providers.map((p) => ({ title: p.title, value: p.value })),
        ],
      });
      if (typeof provider !== "string") return;
      if (provider) deps.config.setDefaultProvider(validateProvider(provider));
      else deps.config.clearDefaultProvider();
      deps.spinner().succeed(chalk.green("Default provider saved"));
      break;
    }
    case "model": {
      const { provider } = await deps.prompt({
        type: "select",
        name: "provider",
        message: "Provider to configure",
        choices: providers.map((p) => ({ title: p.title, value: p.value })),
      });
      if (typeof provider !== "string") return;
      const selected = validateProvider(provider);
      const currentModel = deps.config.getModel(selected);
      const { model } = await deps.prompt({
        type: "text",
        name: "model",
        message: `Preferred model ID${currentModel ? ` (current: ${currentModel})` : ""} (blank clears the preference)`,
      });
      if (typeof model !== "string") return;
      if (model.trim()) deps.config.setModel(selected, model);
      else deps.config.clearModel(selected);
      deps.spinner().succeed(chalk.green("Model preference saved"));
      break;
    }
    case "endpoint": {
      const saved = await configureCustomEndpoint(deps.prompt, deps.config);
      if (saved)
        deps
          .spinner()
          .succeed(chalk.green("Custom endpoint saved (Chat Completions)"));
      break;
    }
    case "set": {
      const savedPrompt = deps.promptConfig.getPrompt();
      const prompt = await deps.readPromptInput(
        "Enter your default commit style prompt",
        savedPrompt,
      );

      if (!prompt) {
        deps.spinner().fail(chalk.red("No prompt provided"));
        return;
      }

      deps.promptConfig.setPrompt(prompt);
      deps.spinner().succeed(chalk.green("Default prompt saved successfully"));
      break;
    }
    case "show": {
      displayPrompt(deps.promptConfig.getPrompt(), deps.log, "\n");
      displayProviderConfig(deps);
      break;
    }
    case "clear": {
      const savedPrompt = deps.promptConfig.getPrompt();
      if (!savedPrompt) {
        deps.spinner().warn(chalk.yellow("No default prompt to clear"));
        return;
      }

      const { confirm } = (await deps.prompt({
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to clear the default prompt?",
      })) as { confirm?: boolean };

      if (!confirm) {
        deps.spinner().fail(chalk.red("Operation cancelled"));
        return;
      }

      deps.promptConfig.clearPrompt();
      deps.spinner().succeed(chalk.green("Default prompt cleared"));
      break;
    }
  }
};

export const createConfigCommand = (
  deps: Partial<ConfigCommandDeps> = {},
): ICommand => {
  const services = { ...defaultDeps, ...deps };

  return {
    name: "config",
    description:
      "Manage prompts, default provider, models, and local endpoints",
    options: [
      ...contextOptions,
      {
        flags: "--default-provider <provider>",
        description: "Save the default AI provider",
      },
      {
        flags: "--clear-default-provider",
        description: "Return to automatic provider selection",
      },
      {
        flags: "--provider <provider>",
        description: "Provider whose model or endpoint to configure",
      },
      {
        flags: "--model <model>",
        description: "Save a preferred model for --provider",
      },
      {
        flags: "--clear-model",
        description: "Clear the model preference for --provider",
      },
      {
        flags: "--base-url <url>",
        description:
          "Custom Chat Completions API base URL (e.g. http://localhost:11434/v1)",
      },
      {
        flags: "--api-key <key>",
        description: "Set optional authentication for --provider custom",
      },
      {
        flags: "--clear-api-key",
        description: "Use --provider custom without authentication",
      },
      {
        flags: "--clear-custom-endpoint",
        description:
          "Remove the custom endpoint, model, key, and its default-provider selection",
      },
      {
        flags: "-s, --show",
        description: "Show current configuration",
      },
      {
        flags: "--show-effective",
        description:
          "Show resolved commit conventions, sources, and compatibility diagnostics",
      },
      {
        flags: "--add-custom-prompt <prompt>",
        description: "Set the default prompt non-interactively",
      },
      {
        flags: "--clear-custom-prompt",
        description: "Clear the default prompt non-interactively",
      },
    ],
    action: async (options) => {
      try {
        await configAction(options as ConfigOptions, services);
      } catch (error) {
        services
          .spinner()
          .fail(
            chalk.red(error instanceof Error ? error.message : String(error)),
          );
        services.setExitCode(1);
      }
    },
  };
};

const ConfigCommand = createConfigCommand();

export default ConfigCommand;
