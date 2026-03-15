import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ICommand } from "../definitions";
import {
  setPrompt,
  getPrompt,
  clearPrompt,
} from "../utils/prompt-config";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

const readPromptInput = (
  message: string,
  initial: string = "",
): Promise<string | null> => {
  return new Promise((resolve) => {
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

type ConfigOptions = {
  show?: boolean;
  addCustomPrompt?: string;
  clearCustomPrompt?: boolean;
};

const displayPrompt = (savedPrompt: string, prefix: string = "") => {
  if (savedPrompt) {
    console.log(chalk.bold(`${prefix}Default prompt:`));
    console.log(chalk.cyan(savedPrompt));
  } else {
    console.log(chalk.yellow(`${prefix}No default prompt configured.`));
  }
};

const configAction = async (options: ConfigOptions = {}) => {
  if (options.addCustomPrompt) {
    setPrompt(options.addCustomPrompt);
    ora().succeed(chalk.green("Default prompt saved successfully"));
    return;
  }

  if (options.clearCustomPrompt) {
    const { cleared } = clearPrompt();
    if (!cleared) {
      ora().warn(chalk.yellow("No default prompt to clear"));
      return;
    }
    ora().succeed(chalk.green("Default prompt cleared"));
    return;
  }

  if (options.show) {
    displayPrompt(getPrompt());
    return;
  }

  const { action } = await prompts({
    type: "select",
    name: "action",
    message: "What would you like to configure?",
    choices: [
      { title: "Set default prompt (commit style)", value: "set" },
      { title: "Show current configuration", value: "show" },
      { title: "Clear default prompt", value: "clear" },
    ],
  });

  if (!action) {
    ora().fail(chalk.red("No option selected"));
    return;
  }

  switch (action) {
    case "set": {
      const savedPrompt = getPrompt();
      const prompt = await readPromptInput(
        "Enter your default commit style prompt",
        savedPrompt,
      );

      if (!prompt) {
        ora().fail(chalk.red("No prompt provided"));
        return;
      }

      setPrompt(prompt);
      ora().succeed(chalk.green("Default prompt saved successfully"));
      break;
    }
    case "show": {
      displayPrompt(getPrompt(), "\n");
      break;
    }
    case "clear": {
      const savedPrompt = getPrompt();
      if (!savedPrompt) {
        ora().warn(chalk.yellow("No default prompt to clear"));
        return;
      }

      const { confirm } = await prompts({
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to clear the default prompt?",
      });

      if (!confirm) {
        ora().fail(chalk.red("Operation cancelled"));
        return;
      }

      clearPrompt();
      ora().succeed(chalk.green("Default prompt cleared"));
      break;
    }
  }
};

const ConfigCommand: ICommand = {
  name: "config",
  description: "Manage gsmart configuration (default prompt, commit style)",
  options: [
    {
      flags: "-s, --show",
      description: "Show current configuration",
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
  action: (options) => configAction(options as ConfigOptions),
};

export default ConfigCommand;
