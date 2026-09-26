import { stripVTControlCharacters } from "node:util";
import { AIBuilder } from "../utils/ai";
import config from "../utils/config";
import { conventionsFromOptions } from "../utils/conventions";
import { resolveContextBudget } from "../utils/context-budget";
import type { ContextReport } from "../utils/diff-context";
import type { GenerationCommandOptions } from "../utils/generation-options";
import {
  commitChanges,
  getRecentCommitSubjects,
  getStagedSnapshot,
  stageAllChanges,
  type StagedSnapshot,
} from "../utils/git";
import { withInterruptHandler } from "../utils/interrupt";
import {
  isProviderConfigured,
  usesOpenAIOAuth,
} from "../utils/provider-config";
import {
  getActiveProviders,
  resolveModel,
  validateBaseURL,
  validateModel,
  validateProvider,
} from "../utils/providers";
import { loadEffectiveConventions } from "../utils/repository-config";
import { readStdinDiff } from "../utils/stdin";
import {
  errorMessage,
  WorkflowError,
  workflowFailure,
  writeWorkflowResult,
  type WorkflowErrorCode,
  type WorkflowResult,
} from "../utils/workflow-result";

type MachineDeps = {
  config: typeof config;
  AIBuilder: new (
    provider: AIBuilder["provider"],
    prompt: string,
  ) => Pick<AIBuilder, "generateCommitMessage">;
  getActiveProviders: typeof getActiveProviders;
  loadEffectiveConventions: typeof loadEffectiveConventions;
  getRecentCommitSubjects: typeof getRecentCommitSubjects;
  readStdinDiff: typeof readStdinDiff;
  stageAllChanges: typeof stageAllChanges;
  getStagedSnapshot: typeof getStagedSnapshot;
  commitChanges: typeof commitChanges;
  writeResult: typeof writeWorkflowResult;
  diagnostic: (text: string) => void;
  setExitCode: (code: number) => void;
};

const defaultDeps: MachineDeps = {
  config,
  AIBuilder,
  getActiveProviders,
  loadEffectiveConventions,
  getRecentCommitSubjects,
  readStdinDiff,
  stageAllChanges,
  getStagedSnapshot,
  commitChanges,
  writeResult: writeWorkflowResult,
  diagnostic: (text) => {
    process.stderr.write(stripVTControlCharacters(text) + "\n");
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export function validateMachineOptions(
  options: GenerationCommandOptions,
): void {
  if (
    options.output !== undefined &&
    !["message", "json"].includes(options.output)
  )
    throw new WorkflowError("USAGE", "--output must be message or json.");
  if (options.yes || options.dryRun)
    throw new WorkflowError(
      "USAGE",
      "--yes and --dry-run cannot be combined with machine workflow flags. Use --output message or --output json to generate only; add --stage and/or --commit explicitly.",
    );
  if (options.stdin && (options.stage || options.commit))
    throw new WorkflowError(
      "USAGE",
      "--stdin cannot be combined with --stage or --commit. Supplied diffs are generation-only input.",
    );
  if (options.branch !== undefined && !options.branch.trim())
    throw new WorkflowError("USAGE", "--branch must be a non-empty name.");
}

/** Noninteractive execution has explicit Git effects and exactly one result. */
export const createMachineWorkflow = (overrides: Partial<MachineDeps> = {}) => {
  const deps = { ...defaultDeps, ...overrides };
  return async (options: GenerationCommandOptions): Promise<void> => {
    const controller = new AbortController();
    let canceledBy: NodeJS.Signals | undefined;
    await withInterruptHandler(
      (signal) => {
        canceledBy = signal;
        controller.abort();
      },
      async () => {
        let phase: WorkflowErrorCode = "CONFIGURATION";
        let message: string | undefined;
        let result: WorkflowResult;
        let exitCode = 0;
        try {
          validateMachineOptions(options);
          let cli;
          try {
            cli = conventionsFromOptions(options);
            if (options.provider !== undefined)
              validateProvider(options.provider);
            if (options.model !== undefined) validateModel(options.model);
          } catch (error) {
            throw new WorkflowError("USAGE", errorMessage(error));
          }
          const savedPrompt = deps.config.getPrompt();
          const effective = await deps.loadEffectiveConventions({
            user: savedPrompt ? { instructions: savedPrompt } : {},
            cli,
          });
          for (const diagnostic of effective.diagnostics)
            deps.diagnostic(diagnostic);
          const requested =
            options.provider ?? deps.config.getDefaultProvider();
          const provider =
            requested !== undefined
              ? validateProvider(requested)
              : deps
                  .getActiveProviders()
                  .find((p) =>
                    isProviderConfigured(p.value, deps.config, options.model),
                  )?.value;
          if (!provider)
            throw new WorkflowError(
              "CONFIGURATION",
              "No configured providers found. Run `gsmart login` or configure a custom endpoint with `gsmart config --provider custom --base-url <url> --model <model>`.",
            );
          if (provider === "custom")
            validateBaseURL(deps.config.getCustomBaseURL());
          const model = resolveModel(
            provider,
            options.model,
            deps.config.getModel(provider),
            provider === "openai" && usesOpenAIOAuth(deps.config),
          );
          if (!isProviderConfigured(provider, deps.config, model))
            throw new WorkflowError(
              "AUTHENTICATION",
              `Provider ${provider} is not configured. Run \`gsmart login\` or select a configured provider with --provider.`,
            );
          resolveContextBudget(provider, model, effective.conventions.context);
          controller.signal.throwIfAborted();

          phase = "GIT";
          const history = effective.conventions.history;
          const historyExamples =
            history.enabled && effective.root
              ? await deps.getRecentCommitSubjects(
                  effective.root,
                  history.limit,
                )
              : [];
          controller.signal.throwIfAborted();
          let snapshot: StagedSnapshot | undefined;
          let diff: string;
          if (options.stdin) {
            phase = "INPUT";
            diff = await deps.readStdinDiff(controller.signal);
          } else {
            if (options.stage) await deps.stageAllChanges();
            controller.signal.throwIfAborted();
            snapshot = await deps.getStagedSnapshot();
            diff = snapshot.diff;
          }
          controller.signal.throwIfAborted();
          if (!diff.trim())
            throw new WorkflowError(
              "NO_INPUT",
              options.stdin
                ? "No diff received on stdin. Pipe or redirect a non-empty diff."
                : "No staged changes found. Stage files with git add, use --stage explicitly, or supply a diff with --stdin.",
            );

          phase = "GENERATION";
          const branch = options.branch ?? snapshot?.branch ?? "";
          let report: ContextReport | undefined;
          const ai = new deps.AIBuilder(
            provider,
            effective.conventions.instructions,
          );
          const generated = await ai.generateCommitMessage(branch, diff, {
            model,
            conventions: effective.conventions,
            historyExamples,
            abortSignal: controller.signal,
            onContextPrepared: (value) => {
              report = value;
            },
          });
          controller.signal.throwIfAborted();
          if (typeof generated !== "string")
            throw new WorkflowError(
              generated.code ?? "GENERATION",
              generated.error,
              generated.contextRecovery,
            );
          if (!generated.trim())
            throw new WorkflowError(
              "GENERATION",
              "The AI returned an empty commit message. Please try again.",
            );
          message = generated.replace(/\n*$/, "");

          if (options.commit) {
            phase = "GIT";
            const latest = await deps.getStagedSnapshot(snapshot);
            controller.signal.throwIfAborted();
            if (!latest.diff || latest.fingerprint !== snapshot!.fingerprint)
              throw new WorkflowError(
                "GIT",
                "Staged content changed during generation. Nothing committed. Run gsmart again for the current changes.",
              );
            let detail: string | undefined;
            if (
              !(await deps.commitChanges(message, (error) => {
                detail = error.message;
              }))
            )
              throw new WorkflowError(
                "GIT",
                `Failed to commit changes: ${detail ?? "Git commit failed."}`,
              );
          }
          if (options.showContext && options.output !== "json" && report)
            deps.diagnostic(JSON.stringify({ context: report }, null, 2));
          result = {
            schemaVersion: 1,
            ok: true,
            message,
            provider,
            model,
            input: {
              source: options.stdin ? "stdin" : "index",
              branch: branch || null,
            },
            staged: Boolean(options.stage),
            committed: Boolean(options.commit),
            ...(options.showContext && report ? { context: report } : {}),
          };
        } catch (error) {
          const code = canceledBy
            ? "CANCELED"
            : error instanceof WorkflowError
              ? error.code
              : phase;
          const failure = workflowFailure(
            code,
            canceledBy
              ? `Generation canceled by ${canceledBy}.`
              : errorMessage(error),
          );
          if (error instanceof WorkflowError && error.recovery)
            failure.error.recovery = error.recovery;
          if (message !== undefined) failure.message = message;
          result = failure;
          exitCode =
            canceledBy === "SIGINT"
              ? 130
              : canceledBy === "SIGTERM"
                ? 143
                : code === "USAGE"
                  ? 2
                  : 1;
        }
        deps.setExitCode(exitCode);
        deps.writeResult(result, options.output);
      },
    );
  };
};
