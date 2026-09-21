import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand, IProvider } from "../definitions";
import {
  commitChanges,
  getGitBranch,
  getStagedSnapshot,
  parseDiffFileNames,
  type StagedSnapshot,
} from "../utils/git";
import config from "../utils/config";
import { AIBuilder, type GenerationOptions } from "../utils/ai";
import { getActiveProviders } from "../utils/providers";
import { copyToClipboard, retrieveFilesToCommit } from "../utils";
import { debugLog, debugTime } from "../utils/debug";
import { editMessage } from "../utils/editor";
import { withInterruptHandler } from "../utils/interrupt";

type MainCommandOptions = {
  prompt?: string;
  provider?: string;
  yes?: boolean;
  dryRun?: boolean;
};

type PromptFn = (question: Parameters<typeof prompts>[0]) => Promise<{
  [key: string]: unknown;
}>;

type AIBuilderConstructor = new (
  provider: IProvider["value"],
  prompt: string,
) => {
  generateCommitMessage(
    branchName: string,
    changes: string,
    options?: Parameters<AIBuilder["generateCommitMessage"]>[2],
  ): ReturnType<AIBuilder["generateCommitMessage"]>;
};

type MainCommandDeps = {
  spinner: typeof ora;
  prompt: PromptFn;
  config: typeof config;
  AIBuilder: AIBuilderConstructor;
  getActiveProviders: typeof getActiveProviders;
  retrieveFilesToCommit: typeof retrieveFilesToCommit;
  getGitBranch: typeof getGitBranch;
  getStagedSnapshot: typeof getStagedSnapshot;
  editMessage: typeof editMessage;
  commitChanges: typeof commitChanges;
  copyToClipboard: typeof copyToClipboard;
  parseDiffFileNames: typeof parseDiffFileNames;
  debugLog: typeof debugLog;
  debugTime: typeof debugTime;
  log: typeof console.log;
  setExitCode: (code: number) => void;
};

const defaultDeps: MainCommandDeps = {
  spinner: ora,
  prompt: prompts,
  config,
  AIBuilder,
  getActiveProviders,
  retrieveFilesToCommit,
  getGitBranch,
  getStagedSnapshot,
  editMessage,
  commitChanges,
  copyToClipboard,
  parseDiffFileNames,
  debugLog,
  debugTime,
  log: console.log,
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

type Candidate = {
  message: string;
  source: "generated" | "edited" | "refined";
  snapshot: StagedSnapshot;
};

const getProvider = async (
  provider: string,
  skipPrompt = false,
  deps: MainCommandDeps = defaultDeps,
): Promise<IProvider | null> => {
  const allKeys = deps.config.getAllKeys();
  const activeProviders = deps
    .getActiveProviders()
    .filter(
      (p) =>
        allKeys[p.value] ||
        (p.value === "openai" &&
          deps.config.getOpenAIAuthMode() === "oauth" &&
          Boolean(deps.config.getOpenAIOAuthTokens())),
    );

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

  const { value } = (await deps.prompt({
    type: "select",
    name: "value",
    message: "Select an AI provider",
    choices: activeProviders.map((p) => ({ title: p.title, value: p.value })),
  })) as { value?: string };
  const selectedProvider =
    activeProviders.find((p) => p.value === value) || null;
  return selectedProvider;
};

const mainAction = async (
  options: MainCommandOptions = {},
  deps: MainCommandDeps = defaultDeps,
) => {
  const spinner = deps.spinner("").start();
  const [changes, branch] = await Promise.all([
    deps.retrieveFilesToCommit(spinner, {
      autoStage: Boolean(options.yes),
      dryRun: Boolean(options.dryRun),
    }),
    deps.getGitBranch(),
  ]);

  if (!changes) {
    spinner.stop();
    return;
  }

  spinner.stop();
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

  const readSnapshot = async (): Promise<StagedSnapshot | null> => {
    try {
      const snapshot = await deps.getStagedSnapshot();
      if (!snapshot.diff) {
        spinner.warn(
          chalk.yellow(
            "No staged changes remain. Stage changes before committing.",
          ),
        );
        return null;
      }
      return snapshot;
    } catch (error) {
      spinner.fail(
        chalk.red(
          `Could not inspect staged changes: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return null;
    }
  };

  // Dry-run may have already unstaged its temporary selection. Use its captured
  // diff; committing sessions instead capture a coherent index/base snapshot.
  const snapshot = options.dryRun
    ? { branch, diff: changes, fingerprint: "dry-run" }
    : await readSnapshot();
  if (!snapshot) {
    deps.setExitCode(1);
    return;
  }

  deps.debugLog("generate", `provider: ${selectedProvider.title}`);
  if (options.provider)
    spinner.info(chalk.green(`Using provider: ${selectedProvider.title}`));
  const prompt = options.prompt || deps.config.getPrompt() || "";
  const ai = new deps.AIBuilder(selectedProvider.value, prompt);

  const generate = async (
    context: StagedSnapshot,
    refinement?: GenerationOptions["refinement"],
    cancellable = false,
  ): Promise<string | null> => {
    spinner.start();
    spinner.text = "Generating commit message...";
    deps.debugLog("generate", `branch: ${context.branch}`);
    const stopTimer = deps.debugTime("generate");
    const controller = new AbortController();
    const request = async (): Promise<string | null> => {
      try {
        const message = await ai.generateCommitMessage(
          context.branch,
          context.diff,
          {
            ...(refinement ? { refinement } : {}),
            ...(cancellable ? { abortSignal: controller.signal } : {}),
            onRetry: (attempt, maxRetries) => {
              spinner.text = chalk.yellow(
                `Retrying... (attempt ${attempt + 1}/${maxRetries})`,
              );
            },
          },
        );
        if (controller.signal.aborted) return null;
        if (typeof message === "object") {
          spinner.fail(chalk.red(message.error));
          return null;
        }
        if (!message.trim()) {
          spinner.fail(
            chalk.red(
              "The AI returned an empty commit message. Please try again.",
            ),
          );
          return null;
        }
        spinner.succeed(chalk.green("Message generated"));
        return message;
      } catch (error) {
        if (!controller.signal.aborted) {
          spinner.fail(
            chalk.red(
              `Could not generate a message: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
        return null;
      } finally {
        stopTimer();
        spinner.stop();
        if (controller.signal.aborted)
          spinner.info(
            chalk.yellow("Generation canceled. Current candidate kept."),
          );
      }
    };
    return cancellable
      ? withInterruptHandler(() => controller.abort(), request)
      : request();
  };

  const message = await generate(snapshot);
  if (message === null) return;

  if (options.dryRun) {
    deps.log(chalk.green(message));
    const fileNames = deps.parseDiffFileNames(changes);
    if (fileNames.length > 0) {
      deps.log(chalk.cyan("\nStaged files:"));
      for (const file of fileNames) deps.log(chalk.grey(`  ${file}`));
    }
    return;
  }

  const copy = async (text: string) => {
    if (await deps.copyToClipboard(text)) {
      spinner.succeed(chalk.green("Message copied to clipboard"));
    } else {
      spinner.warn(chalk.yellow("Could not copy message to clipboard"));
      deps.log(text);
    }
  };
  const commit = async (text: string) => {
    if (await deps.commitChanges(text)) {
      spinner.succeed(chalk.green("Changes committed successfully"));
    } else {
      spinner.fail(chalk.red("Failed to commit changes."));
      await copy(text);
    }
  };

  if (options.yes) {
    deps.log(chalk.green(message));
    const latest = await readSnapshot();
    if (!latest || latest.fingerprint !== snapshot.fingerprint) {
      spinner.fail(
        chalk.red(
          "Staged content changed or could not be verified. Nothing committed. Run gsmart again to review the current changes.",
        ),
      );
      deps.setExitCode(1);
      return;
    }
    await commit(message);
    return;
  }

  const candidates: Candidate[] = [{ message, source: "generated", snapshot }];
  let selected = 0;
  let latestFingerprint = snapshot.fingerprint;
  const addCandidate = (
    text: string,
    source: Candidate["source"],
    context: StagedSnapshot,
  ) => {
    candidates.push({ message: text, source, snapshot: context });
    selected = candidates.length - 1;
  };
  const label = (candidate: Candidate, index: number) =>
    `#${index + 1} (${candidate.source}${candidate.snapshot.fingerprint !== latestFingerprint ? ", outdated" : ""})`;

  while (true) {
    const current = candidates[selected];
    deps.log(chalk.cyan(`\nCandidate ${label(current, selected)}:`));
    deps.log(current.message);
    const { action } = await deps.prompt({
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { title: "Commit", value: "commit" },
        { title: "Edit message", value: "edit" },
        { title: "Regenerate with feedback", value: "regenerate" },
        { title: "Browse / restore candidates", value: "history" },
        { title: "Copy message to clipboard", value: "copy" },
        { title: "Do nothing", value: "nothing" },
      ],
    });

    switch (action) {
      case "commit": {
        const latest = await readSnapshot();
        if (!latest) continue;
        latestFingerprint = latest.fingerprint;
        if (latest.fingerprint !== current.snapshot.fingerprint) {
          spinner.warn(
            chalk.yellow(
              "Staged content has changed. This candidate is outdated; regenerate and review before committing.",
            ),
          );
          const { refresh } = await deps.prompt({
            type: "confirm",
            name: "refresh",
            message: "Generate a message for the updated staged changes?",
            initial: false,
          });
          if (refresh !== true) continue;
          // Staging may change while the user is deciding whether to refresh.
          const refreshed = await readSnapshot();
          if (!refreshed) continue;
          latestFingerprint = refreshed.fingerprint;
          const next = await generate(refreshed, undefined, true);
          if (next !== null) addCandidate(next, "generated", refreshed);
          continue;
        }
        await commit(current.message);
        return;
      }
      case "edit": {
        const result = await deps.editMessage(current.message);
        if (result.status === "edited") {
          addCandidate(result.message, "edited", current.snapshot);
        } else if (result.status === "error") {
          spinner.fail(chalk.red(result.error));
        }
        break;
      }
      case "regenerate": {
        const { feedback } = await deps.prompt({
          type: "text",
          name: "feedback",
          message:
            "What should change? (e.g. shorter; blank for another version; Esc to cancel)",
        });
        if (typeof feedback !== "string") break;
        const next = await generate(
          current.snapshot,
          { previousMessage: current.message, feedback },
          true,
        );
        if (next !== null) addCandidate(next, "refined", current.snapshot);
        break;
      }
      case "history": {
        const { candidate } = await deps.prompt({
          type: "select",
          name: "candidate",
          message: "Select a candidate to compare (Esc to go back)",
          initial: selected,
          choices: candidates.map((entry, index) => ({
            title: `${label(entry, index)} ${entry.message.split(/\r?\n/)[0]}${index === selected ? " [current]" : ""}`,
            value: index,
          })),
        });
        if (
          typeof candidate !== "number" ||
          !Number.isInteger(candidate) ||
          !candidates[candidate]
        )
          break;
        const previous = candidates[candidate];
        deps.log(
          chalk.cyan(`\nCurrent candidate ${label(current, selected)}:`),
        );
        deps.log(current.message);
        deps.log(
          chalk.cyan(`\nPreview candidate ${label(previous, candidate)}:`),
        );
        deps.log(previous.message);
        const { restore } = await deps.prompt({
          type: "confirm",
          name: "restore",
          message: "Restore this candidate?",
          initial: false,
        });
        if (restore === true) selected = candidate;
        break;
      }
      case "copy":
        await copy(current.message);
        return;
      case "nothing":
        spinner.succeed(chalk.yellow("No action taken"));
        return;
      default:
        spinner.fail(chalk.red("No action selected. Doing nothing."));
        return;
    }
  }
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
    action: (options) => mainAction(options as MainCommandOptions, services),
  };

  return command;
};

const MainCommand = createMainCommand();

export default MainCommand;
