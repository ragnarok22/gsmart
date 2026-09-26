import { stripVTControlCharacters } from "node:util";
import type { ICommand } from "../definitions";
import { AIBuilder, type GenerationError } from "../utils/ai";
import config from "../utils/config";
import { conventionsFromOptions } from "../utils/conventions";
import {
  generationContextOptions,
  isMachineWorkflow,
  type GenerationCommandOptions,
} from "../utils/generation-options";
import { getRecentCommitSubjects, getStagedSnapshot } from "../utils/git";
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
import {
  inventoryChanges,
  renderSplitPlan,
  type SplitPlan,
} from "../utils/split-plan";
import { errorMessage, WorkflowError } from "../utils/workflow-result";

type PlanOptions = GenerationCommandOptions & { staged?: boolean };

type PlanDeps = {
  config: typeof config;
  AIBuilder: new (
    provider: AIBuilder["provider"],
    prompt: string,
  ) => Pick<AIBuilder, "generateCommitPlan">;
  getActiveProviders: typeof getActiveProviders;
  loadEffectiveConventions: typeof loadEffectiveConventions;
  getRecentCommitSubjects: typeof getRecentCommitSubjects;
  getStagedSnapshot: typeof getStagedSnapshot;
  output: (text: string) => void;
  diagnostic: (text: string) => void;
  setExitCode: (code: number) => void;
};

const defaultDeps: PlanDeps = {
  config,
  AIBuilder,
  getActiveProviders,
  loadEffectiveConventions,
  getRecentCommitSubjects,
  getStagedSnapshot,
  output: (text) => {
    process.stdout.write(text + "\n");
  },
  diagnostic: (text) => {
    process.stderr.write(stripVTControlCharacters(text) + "\n");
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export function createPlanCommand(overrides: Partial<PlanDeps> = {}): ICommand {
  const deps = { ...defaultDeps, ...overrides };
  return {
    name: "plan",
    description:
      "Suggest an advisory commit-splitting plan for explicitly staged changes",
    silent: true,
    inheritGenerationOptions: true,
    options: [
      ...generationContextOptions,
      {
        flags: "--staged",
        description:
          "Plan the existing staged diff (required); leaves the repository unchanged",
      },
    ],
    action: async (args) => {
      const options = args as PlanOptions;
      const controller = new AbortController();
      let canceledBy: NodeJS.Signals | undefined;
      await withInterruptHandler(
        (signal) => {
          canceledBy = signal;
          controller.abort();
        },
        async () => {
          try {
            if (options.staged !== true)
              throw new WorkflowError(
                "USAGE",
                "Choose the planning scope explicitly: gsmart plan --staged.",
              );
            if (options.yes || options.dryRun || isMachineWorkflow(options))
              throw new WorkflowError(
                "USAGE",
                "Planning supports --staged only; --yes, --dry-run, --stage, --commit, --stdin, --branch and --output cannot be combined with plan.",
              );
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
            controller.signal.throwIfAborted();
            const snapshot = await deps.getStagedSnapshot();
            if (!snapshot.diff.trim())
              throw new WorkflowError(
                "NO_INPUT",
                "No staged changes found. Stage the changes to plan with git add, then run gsmart plan --staged.",
              );
            const changes = inventoryChanges(
              snapshot.diff,
              effective.conventions.context,
            );
            if (!changes.length)
              throw new WorkflowError("NO_INPUT", "No staged changes to plan.");
            let plan: SplitPlan | GenerationError;
            if (changes.every((change) => change.excluded)) {
              plan = { changes, commits: [] };
            } else {
              const requested =
                options.provider ?? deps.config.getDefaultProvider();
              const provider =
                requested !== undefined
                  ? validateProvider(requested)
                  : deps
                      .getActiveProviders()
                      .find((p) =>
                        isProviderConfigured(
                          p.value,
                          deps.config,
                          options.model,
                        ),
                      )?.value;
              if (!provider)
                throw new WorkflowError(
                  "CONFIGURATION",
                  "No configured providers found. Run `gsmart login` or configure a custom endpoint, then run gsmart plan --staged.",
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
                  `Provider ${provider} is not configured. Run gsmart login or select a configured provider with --provider.`,
                );
              const history = effective.conventions.history;
              const historyExamples =
                history.enabled && effective.root
                  ? await deps.getRecentCommitSubjects(
                      effective.root,
                      history.limit,
                    )
                  : [];
              controller.signal.throwIfAborted();
              const ai = new deps.AIBuilder(
                provider,
                effective.conventions.instructions,
              );
              plan = await ai.generateCommitPlan(
                snapshot.branch,
                snapshot.diff,
                {
                  model,
                  conventions: effective.conventions,
                  historyExamples,
                  abortSignal: controller.signal,
                },
              );
            }
            controller.signal.throwIfAborted();
            if ("error" in plan)
              throw new WorkflowError(plan.code ?? "GENERATION", plan.error);
            const latest = await deps.getStagedSnapshot(snapshot);
            controller.signal.throwIfAborted();
            if (snapshot.fingerprint !== latest.fingerprint)
              throw new WorkflowError(
                "GIT",
                "Staged content or HEAD changed during planning. Run gsmart plan --staged again for the current snapshot.",
              );
            if (options.showContext && plan.context)
              deps.diagnostic(
                JSON.stringify({ context: plan.context }, null, 2),
              );
            deps.output(renderSplitPlan(plan));
            deps.setExitCode(0);
          } catch (error) {
            deps.diagnostic(
              canceledBy
                ? `Planning canceled by ${canceledBy}. Repository unchanged.`
                : `error: ${errorMessage(error)}`,
            );
            deps.setExitCode(
              canceledBy === "SIGINT"
                ? 130
                : canceledBy === "SIGTERM"
                  ? 143
                  : error instanceof WorkflowError && error.code === "USAGE"
                    ? 2
                    : 1,
            );
          }
        },
      );
    },
  };
}

export default createPlanCommand();
