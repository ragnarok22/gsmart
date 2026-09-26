import ora from "ora";
import chalk from "chalk";
import { stripVTControlCharacters } from "node:util";
import prompts from "prompts";
import { ICommand, IProvider, type EffectiveConventions } from "../definitions";
import {
  commitChanges,
  getGitBranch,
  getStagedSnapshot,
  getRecentCommitSubjects,
  parseDiffFileNames,
  type StagedSnapshot,
} from "../utils/git";
import config from "../utils/config";
import { AIBuilder, type GenerationOptions } from "../utils/ai";
import {
  getActiveProviders,
  validateProvider,
  validateModel,
  validateBaseURL,
  resolveModel,
} from "../utils/providers";
import {
  isProviderConfigured,
  usesOpenAIOAuth,
} from "../utils/provider-config";
import { copyToClipboard, retrieveFilesToCommit } from "../utils";
import { debugLog, debugTime } from "../utils/debug";
import { editMessage } from "../utils/editor";
import { withInterruptHandler } from "../utils/interrupt";
import { loadEffectiveConventions } from "../utils/repository-config";
import {
  generationOptions,
  isMachineWorkflow,
  type GenerationCommandOptions,
} from "../utils/generation-options";
import { createMachineWorkflow } from "./machine";
import { resolveContextBudget } from "../utils/context-budget";
import { conventionsFromOptions } from "../utils/conventions";

type MainCommandOptions = GenerationCommandOptions;

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
  isInteractive: () => boolean;
  config: typeof config;
  AIBuilder: AIBuilderConstructor;
  getActiveProviders: typeof getActiveProviders;
  retrieveFilesToCommit: typeof retrieveFilesToCommit;
  getGitBranch: typeof getGitBranch;
  getStagedSnapshot: typeof getStagedSnapshot;
  loadEffectiveConventions: typeof loadEffectiveConventions;
  getRecentCommitSubjects: typeof getRecentCommitSubjects;
  editMessage: typeof editMessage;
  commitChanges: typeof commitChanges;
  copyToClipboard: typeof copyToClipboard;
  parseDiffFileNames: typeof parseDiffFileNames;
  debugLog: typeof debugLog;
  debugTime: typeof debugTime;
  log: typeof console.log;
  setExitCode: (code: number) => void;
  machineWorkflow: ReturnType<typeof createMachineWorkflow>;
};

const defaultDeps: MainCommandDeps = {
  spinner: ora,
  prompt: prompts,
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  config,
  AIBuilder,
  getActiveProviders,
  retrieveFilesToCommit,
  getGitBranch,
  getStagedSnapshot,
  loadEffectiveConventions,
  getRecentCommitSubjects,
  editMessage,
  commitChanges,
  copyToClipboard,
  parseDiffFileNames,
  debugLog,
  debugTime,
  log: console.log,
  machineWorkflow: createMachineWorkflow(),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

type Candidate = {
  message: string;
  source: "generated" | "edited" | "refined";
  snapshot: StagedSnapshot;
};

type ProviderSelection =
  | { status: "selected"; provider: IProvider }
  | { status: "canceled" }
  | { status: "unavailable" }
  | { status: "invalid" };

const getProvider = async (
  provider: string,
  skipPrompt = false,
  deps: MainCommandDeps = defaultDeps,
  model?: string,
): Promise<ProviderSelection> => {
  const activeProviders = deps
    .getActiveProviders()
    .filter((p) => isProviderConfigured(p.value, deps.config, model));

  if (provider) {
    const selectedProvider = activeProviders.find((p) => p.value === provider);
    if (!selectedProvider) {
      return { status: "invalid" };
    }
    return { status: "selected", provider: selectedProvider };
  }

  if (activeProviders.length === 0) {
    return { status: "unavailable" };
  }

  if (activeProviders.length === 1) {
    return { status: "selected", provider: activeProviders[0] };
  }

  if (skipPrompt) {
    // When skip prompt is enabled, use the first available provider
    return { status: "selected", provider: activeProviders[0] };
  }

  const { value } = await deps.prompt({
    type: "select",
    name: "value",
    message: "Select an AI provider",
    choices: activeProviders.map((p) => ({ title: p.title, value: p.value })),
  });
  if (value === undefined) return { status: "canceled" };
  const selectedProvider = activeProviders.find((p) => p.value === value);
  return selectedProvider
    ? { status: "selected", provider: selectedProvider }
    : { status: "invalid" };
};

const mainAction = async (
  options: MainCommandOptions = {},
  deps: MainCommandDeps = defaultDeps,
) => {
  if (isMachineWorkflow(options)) return deps.machineWorkflow(options);
  const spinner = deps.spinner("").start();
  let effective: EffectiveConventions;
  let historyExamples: string[] = [];
  let requestedProvider: string | undefined;
  let selectedProvider: IProvider;
  let model: string;
  try {
    requestedProvider =
      options.provider !== undefined
        ? validateProvider(options.provider)
        : deps.config.getDefaultProvider();
    if (options.model !== undefined) validateModel(options.model);
    if (requestedProvider) {
      const provider = validateProvider(requestedProvider);
      if (provider === "custom") {
        validateBaseURL(deps.config.getCustomBaseURL());
        resolveModel(provider, options.model, deps.config.getModel(provider));
      }
      if (!isProviderConfigured(provider, deps.config, options.model)) {
        throw new Error(
          `Provider ${provider} is not configured. Run \`gsmart login\` or change the default with \`gsmart config --default-provider <provider>\`.`,
        );
      }
    }
    const savedPrompt = deps.config.getPrompt();
    effective = await deps.loadEffectiveConventions({
      user: savedPrompt ? { instructions: savedPrompt } : {},
      cli: conventionsFromOptions(options),
    });
    for (const diagnostic of effective.diagnostics)
      deps.debugLog("config", diagnostic);
    const history = effective.conventions.history;
    if (history.enabled && effective.root) {
      historyExamples = await deps.getRecentCommitSubjects(
        effective.root,
        history.limit,
      );
    }

    // Resolve configuration before file selection can mutate the index.
    spinner.stop();
    const selection = await getProvider(
      requestedProvider ?? "",
      Boolean(options.yes),
      deps,
      options.model,
    );
    if (selection.status === "canceled") return;
    if (selection.status !== "selected") {
      throw new Error(
        selection.status === "unavailable"
          ? "No configured providers found. Run `gsmart login` for hosted or local setup, or configure a custom endpoint with `gsmart config --provider custom --base-url <url> --model <model>`."
          : "No valid provider found. Please check your API keys.",
      );
    }
    selectedProvider = selection.provider;
    model = resolveModel(
      selectedProvider.value,
      options.model,
      deps.config.getModel(selectedProvider.value),
      selectedProvider.value === "openai" && usesOpenAIOAuth(deps.config),
    );
    resolveContextBudget(
      selectedProvider.value,
      model,
      effective.conventions.context,
    );
  } catch (error) {
    spinner.fail(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    deps.setExitCode(1);
    return;
  }
  let changes: string | null;
  let branch: string;
  let capturedSnapshot: StagedSnapshot | undefined;
  try {
    spinner.start();
    [changes, branch] = await Promise.all([
      deps.retrieveFilesToCommit(spinner, {
        autoStage: Boolean(options.yes),
        dryRun: Boolean(options.dryRun),
        ...(!options.dryRun
          ? {
              onSnapshot: (snapshot: StagedSnapshot) => {
                capturedSnapshot = snapshot;
              },
            }
          : {}),
      }),
      deps.getGitBranch(),
    ]);
  } catch (error) {
    spinner.fail(
      chalk.red(
        `Could not read staged changes: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    deps.setExitCode(1);
    return;
  }

  if (!changes) {
    spinner.stop();
    return;
  }

  spinner.stop();
  try {
    // Credentials may change during interactive file selection.
    if (!isProviderConfigured(selectedProvider.value, deps.config, model)) {
      throw new Error("No valid provider found. Please check your API keys.");
    }
  } catch (error) {
    spinner.fail(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    deps.setExitCode(1);
    return;
  }

  const readSnapshot = async (
    previous?: StagedSnapshot,
  ): Promise<StagedSnapshot | null> => {
    try {
      const snapshot = await deps.getStagedSnapshot(previous);
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
    : (capturedSnapshot ?? (await readSnapshot()));
  if (!snapshot) {
    deps.setExitCode(1);
    return;
  }

  deps.debugLog("generate", `provider: ${selectedProvider.title}`);
  if (options.provider)
    spinner.info(chalk.green(`Using provider: ${selectedProvider.title}`));
  const prompt = effective.conventions.instructions;
  const ai = new deps.AIBuilder(selectedProvider.value, prompt);
  let conventions = effective.conventions;

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
        // At most one approved budget retry per generation. Later candidates
        // reuse the session budget, but can need more room for new feedback.
        for (let attempt = 0; attempt < 2; attempt++) {
          const message = await ai.generateCommitMessage(
            context.branch,
            context.diff,
            {
              model,
              conventions,
              historyExamples,
              onContextPrepared: (report) => {
                const reduced = report.files.filter(
                  (file) => file.treatment !== "full",
                );
                if (reduced.length) {
                  spinner.info(
                    chalk.cyan(
                      `AI context reduced for ${reduced.length} file(s); staged changes preserved. Use --show-context for details.`,
                    ),
                  );
                  spinner.start("Generating commit message...");
                }
                if (options.showContext) {
                  spinner.stop();
                  // JSON quoting prevents paths from injecting terminal controls.
                  deps.log(
                    stripVTControlCharacters(
                      JSON.stringify({ context: report }, null, 2),
                    ),
                  );
                  spinner.start("Generating commit message...");
                }
              },
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
            const recovery = message.contextRecovery;
            const budgetTokens = recovery?.suggestedBudgetTokens;
            if (
              attempt > 0 ||
              options.yes ||
              !deps.isInteractive() ||
              recovery?.kind !== "metadata-overflow" ||
              budgetTokens === undefined ||
              budgetTokens <= recovery.currentBudgetTokens
            )
              return null;
            spinner.stop();
            const { increaseBudget } = await deps.prompt({
              type: "confirm",
              name: "increaseBudget",
              message: `Increase context budget to ${budgetTokens} tokens for this session and retry?`,
              initial: false,
            });
            if (increaseBudget !== true || controller.signal.aborted)
              return null;
            conventions = {
              ...conventions,
              context: { ...conventions.context, budgetTokens },
            };
            spinner.start("Generating commit message...");
            continue;
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
        }
        return null;
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
  if (message === null) {
    deps.setExitCode(1);
    return;
  }

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
    let detail: string | undefined;
    if (
      await deps.commitChanges(text, (error) => {
        detail = error.message;
      })
    ) {
      spinner.succeed(chalk.green("Changes committed successfully"));
    } else {
      spinner.fail(
        chalk.red(
          detail
            ? `Failed to commit changes: ${detail}`
            : "Failed to commit changes.",
        ),
      );
      deps.setExitCode(1);
      await copy(text);
    }
  };

  if (options.yes) {
    deps.log(chalk.green(message));
    const latest = await readSnapshot(snapshot);
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
        const latest = await readSnapshot(current.snapshot);
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
          const refreshed = await readSnapshot(latest);
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
    options: generationOptions,
    action: (options) => mainAction(options as MainCommandOptions, services),
  };

  return command;
};

const MainCommand = createMainCommand();

export default MainCommand;
