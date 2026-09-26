import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import { setTimeout as delay } from "node:timers/promises";
import {
  generateText,
  streamText,
  type LanguageModel,
  type FinishReason,
  APICallError,
  NoSuchModelError,
  EmptyResponseBodyError,
  InvalidResponseDataError,
  JSONParseError,
  NoContentGeneratedError,
} from "ai";
import config, { validateApiKey } from "./config";
import {
  ensureFreshOpenAIOAuthTokens,
  OpenAIOAuthTokens,
} from "./openai-oauth";
import { Provider, type ResolvedConventions } from "../definitions";
import { buildCommitPrompt } from "./commit-prompt";
import { DEFAULT_CONVENTIONS } from "./conventions";
import {
  buildPlanPrompt,
  inventoryChanges,
  parseSplitPlan,
  type SplitPlan,
} from "./split-plan";
import {
  DEFAULT_PROVIDER,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
} from "./constants";
import { debugLog, debugTime } from "./debug";
import { WorkflowError, type WorkflowErrorCode } from "./workflow-result";
import { resolveModel, validateModel, validateBaseURL } from "./providers";
import {
  prepareContext,
  ContextMetadataOverflowError,
  type ContextRecovery,
  type ContextReport,
} from "./diff-context";
import {
  assertRequestFits,
  resolveContextBudget,
  type ContextBudget,
  type ContextRequest,
} from "./context-budget";

export { providers, getActiveProviders } from "./providers";

class StreamInterruptedError extends Error {
  constructor() {
    super("Response stream ended before completion. Please try again.");
  }
}

function classifyError(
  error: unknown,
  provider: string,
  timeoutMs: number,
  context: { modelId: string; baseURL?: string; oauth?: boolean },
): string {
  const modelHint = `Selected model: "${context.modelId}". Use --model <model> or \`gsmart config --provider ${provider} --model <model>\` to change it.`;
  const endpointHint =
    provider === "custom"
      ? ` Endpoint: ${context.baseURL}/chat/completions. Check the server is running, the base URL includes /v1 if required, and the server supports Chat Completions. Change it with \`gsmart config --provider custom --base-url <url>\`.`
      : "";
  const modelError = `${provider} - Model is not available or the endpoint is unsupported. ${modelHint}${endpointHint}${context.oauth ? " Choose a model supported by your ChatGPT subscription, or use API-key login for API-only models." : " Check your plan or try a different provider; for local models, download/load the model on the server."}`;
  const connectionError = `${provider} - Could not reach the ${provider} API. ${provider === "custom" ? endpointHint.trim() : "Check your internet connection."}`;
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  ) {
    return `${provider} - Request timed out after ${timeoutMs / 1000}s. Please check your network connection and try again. Increase GSMART_TIMEOUT for slow models.${endpointHint}`;
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;

    if (status != null && status >= 200 && status < 300) {
      if (error.isRetryable) {
        return `${provider} - Response stream was interrupted. Please try again.${endpointHint}`;
      }
      return `${provider} - Unexpected response from ${provider}. Check the API response format.${endpointHint}`;
    }

    if (status === 401 || status === 403) {
      if (provider === "custom")
        return `${provider} - Endpoint rejected authentication (HTTP ${status}). Set its key with \`gsmart config --provider custom --api-key <key>\` or remove it with --clear-api-key for a keyless server.${endpointHint}`;
      if (context.oauth)
        return `${provider} - ChatGPT authorization or model access was rejected (HTTP ${status}). Run \`gsmart login\` and choose ChatGPT subscription. ${modelHint}`;
      return `${provider} - Invalid API key. Run \`gsmart login\` to reconfigure.`;
    }

    if (status === 429) {
      return `${provider} - Rate limited by ${provider}. Wait a moment and try again.`;
    }

    if (
      status === 404 ||
      status === 405 ||
      ((status === 400 || status === 422) &&
        /model|not supported|unsupported/i.test(error.message))
    ) {
      return modelError;
    }

    if (status == null) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("fetch failed") ||
        msg.includes("econnrefused") ||
        msg.includes("enotfound") ||
        msg.includes("network") ||
        msg.includes("dns")
      ) {
        return connectionError;
      }
    }

    return `${provider} - API request failed (HTTP ${status ?? "unknown"}). Please try again. ${modelHint}${endpointHint}`;
  }

  if (NoSuchModelError.isInstance(error)) {
    return `${provider} - Model "${error.modelId}" is not available. ${modelHint}${endpointHint} Check your plan or try a different provider.`;
  }

  if (
    EmptyResponseBodyError.isInstance(error) ||
    InvalidResponseDataError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    NoContentGeneratedError.isInstance(error)
  ) {
    return `${provider} - Unexpected response from ${provider}. Please try again.${endpointHint}`;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("fetch failed") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("network") ||
      msg.includes("dns")
    ) {
      return connectionError;
    }
  }

  const message =
    error instanceof Error && error.message
      ? error.message
      : "An error occurred while generating the commit message";
  return provider === "custom"
    ? `${provider} - Generation failed. ${modelHint}${endpointHint}`
    : `${provider} - ${message}`;
}

function hasNetworkKeyword(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("network") ||
    lower.includes("dns")
  );
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof StreamInterruptedError) return true;

  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  )
    return true;

  if (APICallError.isInstance(error)) {
    // The SDK marks transport failures while reading an HTTP 200 body retryable.
    if (error.isRetryable) return true;
    const status = error.statusCode;
    if (status === 429) return true;
    if (status != null && status >= 500) return true;
    if (status == null && hasNetworkKeyword(error.message)) return true;
    return false;
  }

  if (NoSuchModelError.isInstance(error)) return false;

  if (
    EmptyResponseBodyError.isInstance(error) ||
    InvalidResponseDataError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    NoContentGeneratedError.isInstance(error)
  ) {
    return false;
  }

  if (error instanceof Error && hasNetworkKeyword(error.message)) return true;

  return false;
}

export type RetryOptions = {
  maxRetries?: number;
  onRetry?: (attempt: number, maxRetries: number) => void;
  delayFn?: (ms: number) => Promise<void>;
};

export type GenerationOptions = RetryOptions & {
  model?: string;
  conventions?: ResolvedConventions;
  historyExamples?: string[];
  abortSignal?: AbortSignal;
  onContextPrepared?: (report: ContextReport) => void;
  refinement?: {
    previousMessage: string;
    feedback: string;
  };
};

export type GenerationError = {
  error: string;
  code?: WorkflowErrorCode;
  contextRecovery?: ContextRecovery;
};

/** Provider request failures always carry a category, including summary calls. */
type RequestError = {
  error: string;
  code: "AUTHENTICATION" | "GENERATION";
};

type ProviderAuth = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  oauth?: boolean;
};

const resolveTimeoutMs = (value: string | undefined): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return parsed;
};

export class AIBuilder {
  provider: Provider;
  prompt: string;

  constructor(provider: Provider = DEFAULT_PROVIDER, prompt: string) {
    this.provider = provider;
    this.prompt = prompt;
  }

  changeProvider(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Generate a commit message using the AI model
   * @param branch_name - The current git branch name
   * @param changes - The changes in the current branch
   * @returns - The generated commit message
   **/
  async generateCommitMessage(
    branch_name: string,
    changes: string,
    options?: GenerationOptions,
  ): Promise<string | GenerationError> {
    return this.__generate(branch_name, changes, options);
  }

  /** Use the same provider/context pipeline, but validate a complete advisory plan. */
  async generateCommitPlan(
    branch: string,
    diff: string,
    options?: GenerationOptions,
  ): Promise<SplitPlan | GenerationError> {
    try {
      options?.abortSignal?.throwIfAborted();
      const conventions = options?.conventions ?? {
        ...DEFAULT_CONVENTIONS,
        instructions: this.prompt,
      };
      const changes = inventoryChanges(diff, conventions.context);
      if (!changes.length)
        return { error: "No staged changes to plan.", code: "NO_INPUT" };
      // Exclusions are local manual-review items, including when all files are
      // excluded. Never send their paths, ranges or contents to the provider.
      if (changes.every((change) => change.excluded))
        return { changes, commits: [] };
      let report: ContextReport | undefined;
      const response = await this.__generate(
        branch,
        diff,
        {
          ...options,
          conventions,
          onContextPrepared: (value) => {
            report = value;
            options?.onContextPrepared?.(value);
          },
        },
        (preparedDiff) =>
          buildPlanPrompt(
            branch,
            changes,
            preparedDiff,
            conventions,
            options?.historyExamples,
          ),
      );
      if (typeof response !== "string") return response;
      options?.abortSignal?.throwIfAborted();
      return parseSplitPlan(response, changes, report);
    } catch (error) {
      return {
        error: options?.abortSignal?.aborted
          ? "Planning canceled."
          : `Could not generate a valid plan: ${error instanceof Error ? error.message : String(error)}`,
        code: options?.abortSignal?.aborted ? "CANCELED" : "GENERATION",
      };
    }
  }

  private async __generate(
    branch_name: string,
    changes: string,
    options?: GenerationOptions,
    promptBuilder?: (changes: string) => ContextRequest,
  ): Promise<string | GenerationError> {
    debugLog("ai", `provider: ${this.provider}`);
    debugLog("ai", `prompt length: ${this.prompt.length} chars`);
    try {
      options?.abortSignal?.throwIfAborted();
      if (options?.model !== undefined) {
        try {
          validateModel(options.model);
        } catch (error) {
          return { error: (error as Error).message, code: "CONFIGURATION" };
        }
      }
      const auth = await this.__resolveAuth();
      options?.abortSignal?.throwIfAborted();
      if ("error" in auth) {
        debugLog("ai", `auth validation failed for ${this.provider}`);
        return auth;
      }

      let modelId: string;
      try {
        modelId = resolveModel(
          this.provider,
          options?.model,
          config.getModel(this.provider),
          auth.oauth,
        );
      } catch (error) {
        return { error: (error as Error).message, code: "CONFIGURATION" };
      }
      debugLog("ai", `model: ${modelId}`);
      const model = this.__generateModel(auth, modelId);
      return await this.__generateText(
        model,
        branch_name,
        changes,
        { ...auth, modelId },
        options,
        promptBuilder,
      );
    } catch (error) {
      if (options?.abortSignal?.aborted)
        return { error: "Generation canceled." };
      throw error;
    }
  }

  private async __resolveAuth(): Promise<ProviderAuth | GenerationError> {
    if (this.provider === "custom") {
      try {
        return {
          baseURL: validateBaseURL(config.getCustomBaseURL()),
          apiKey: config.getKey("custom").trim() || undefined,
        };
      } catch (error) {
        return {
          error: `custom - ${(error as Error).message} Configure it with \`gsmart config --provider custom --base-url <url> --model <model>\`.`,
          code: "CONFIGURATION",
        };
      }
    }
    if (this.provider === "openai") {
      const oauthTokens = this.__getOpenAIOAuthTokens();
      const useOAuth =
        config.getOpenAIAuthMode?.() === "oauth" ||
        (!!oauthTokens && !config.getKey("openai"));

      if (useOAuth) {
        if (!oauthTokens) {
          return {
            error:
              "openai - ChatGPT login is not configured. Run `gsmart login` and choose ChatGPT subscription.",
            code: "AUTHENTICATION",
          };
        }

        try {
          const freshTokens = await ensureFreshOpenAIOAuthTokens(
            oauthTokens,
            (tokens) => config.setOpenAIOAuthTokens?.(tokens),
          );
          return this.__openAIOAuthProviderAuth(freshTokens);
        } catch {
          return {
            error:
              "openai - ChatGPT login expired. Run `gsmart login` and choose ChatGPT subscription again.",
            code: "AUTHENTICATION",
          };
        }
      }
    }

    const apiKey = config.getKey(this.provider);
    const validationError = validateApiKey(this.provider, apiKey);
    if (validationError)
      return { error: validationError, code: "AUTHENTICATION" };

    return { apiKey: apiKey.trim() };
  }

  private __getOpenAIOAuthTokens(): OpenAIOAuthTokens | null {
    return config.getOpenAIOAuthTokens?.() ?? null;
  }

  private __openAIOAuthProviderAuth(tokens: OpenAIOAuthTokens): ProviderAuth {
    return {
      apiKey: tokens.accessToken,
      oauth: true,
      baseURL: "https://chatgpt.com/backend-api/codex",
      headers: {
        ...(tokens.accountId ? { "ChatGPT-Account-ID": tokens.accountId } : {}),
        originator: "gsmart_cli",
      },
    };
  }

  private __generateModel(auth: ProviderAuth, modelId: string): LanguageModel {
    debugLog("ai", `selecting model for provider: ${this.provider}`);
    switch (this.provider) {
      case "openai": {
        const openai = createOpenAI({
          apiKey: auth.apiKey,
          ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
          ...(auth.headers ? { headers: auth.headers } : {}),
        });
        return openai.responses(modelId);
      }
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey: auth.apiKey,
        });
        return anthropic(modelId);
      }
      case "google": {
        const gemini = createGoogleGenerativeAI({
          apiKey: auth.apiKey,
        });

        return gemini(modelId);
      }
      case "mistral": {
        const mistral = createMistral({
          apiKey: auth.apiKey,
        });
        return mistral(modelId);
      }
      case "fireworks": {
        const openai = createOpenAI({
          apiKey: auth.apiKey,
          baseURL: "https://api.fireworks.ai/inference/v1",
        });
        return openai.chat(modelId);
      }
      case "plataformia": {
        const openai = createOpenAI({
          apiKey: auth.apiKey,
          baseURL: "https://apigateway.avangenio.net",
        });
        return openai.chat(modelId);
      }
      case "custom":
        return createOpenAICompatible({
          name: "custom",
          baseURL: auth.baseURL!,
          ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
        }).chatModel(modelId);
      default:
        throw new Error("Invalid provider");
    }
  }

  /**
   * Generate a commit message using the selected AI model
   * @param model - The AI model to use
   * @param branch_name - The current git branch name
   * @param changes - The changes in the current branch
   * @returns - The generated commit message
   * @private - This method is private and should not be accessed directly
   **/
  private async __generateText(
    model: LanguageModel,
    branch_name: string,
    changes: string,
    context: ProviderAuth & { modelId: string },
    options?: GenerationOptions,
    promptBuilder?: (changes: string) => ContextRequest,
  ): Promise<string | GenerationError> {
    const buildPrompt =
      promptBuilder ??
      ((preparedChanges: string): ContextRequest => {
        const [system, initialPrompt] = buildCommitPrompt(
          branch_name,
          preparedChanges,
          options?.conventions,
          options?.historyExamples,
        );
        const instructions = options?.conventions?.instructions ?? this.prompt;
        const refinement = options?.refinement;
        const prompt = [
          initialPrompt,
          instructions ? `Additional instructions:\n${instructions}` : "",
          refinement
            ? `Refine the previous candidate using the original changes above and the feedback below. Preserve relevant details unless the feedback requests otherwise, while following the structured conventions. Return ONLY the complete revised commit message.\n\nPrevious candidate:\n${refinement.previousMessage}\n\nUser feedback:\n${refinement.feedback.trim() || "Generate an alternative version of the previous candidate."}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        return { system, prompt };
      });

    try {
      const budget = resolveContextBudget(
        this.provider,
        context.modelId,
        options?.conventions?.context,
      );
      const prepared = await prepareContext({
        diff: changes,
        budget,
        buildPrompt,
        signal: options?.abortSignal,
        summarize: async (request, beforeAttempt) => {
          const result = await this.__requestText(
            model,
            request,
            context,
            budget,
            options,
            beforeAttempt,
          );
          if (typeof result !== "string")
            throw new WorkflowError(
              result.code,
              `Summarization failed: ${result.error}`,
            );
          return result;
        },
      });
      options?.onContextPrepared?.(prepared.report);
      return await this.__requestText(
        model,
        prepared,
        context,
        budget,
        options,
      );
    } catch (error) {
      if (options?.abortSignal?.aborted) throw error;
      return {
        error: `Context preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        code: error instanceof WorkflowError ? error.code : "CONTEXT",
        ...(error instanceof ContextMetadataOverflowError
          ? { contextRecovery: error.recovery }
          : {}),
      };
    }
  }

  private async __requestText(
    model: LanguageModel,
    { system, prompt }: ContextRequest,
    context: ProviderAuth & { modelId: string },
    budget: ContextBudget,
    options?: GenerationOptions,
    beforeAttempt?: () => void,
  ): Promise<string | RequestError> {
    assertRequestFits({ system, prompt }, budget);
    const timeoutMs = resolveTimeoutMs(process.env.GSMART_TIMEOUT);
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const delayFn =
      options?.delayFn ??
      ((ms: number) => delay(ms, undefined, { signal: options?.abortSignal }));
    debugLog("ai", `timeout: ${timeoutMs}ms`);

    const stopTimer = debugTime("ai");

    const runAttempt = async (
      attempt: number,
    ): Promise<string | RequestError> => {
      options?.abortSignal?.throwIfAborted();
      beforeAttempt?.();
      try {
        const request = {
          model,
          prompt,
          maxOutputTokens: budget.output,
          // The retry loop below owns backoff and diagnostics for both APIs.
          maxRetries: 0,
          timeout: { totalMs: timeoutMs },
          ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
        };
        let text: string;
        if (context.oauth) {
          // The ChatGPT Codex endpoint requires streaming, store:false, and
          // top-level instructions. Buffer the response for the CLI review UI.
          const result = streamText({
            ...request,
            providerOptions: { openai: { store: false, instructions: system } },
            includeRawChunks: true,
            onError: () => {}, // Errors are classified below, without logging credentials.
          });
          text = "";
          let completed = false;
          let finishReason: FinishReason | undefined;
          for await (const part of result.fullStream) {
            if (part.type === "error") throw part.error;
            if (part.type === "abort") {
              options?.abortSignal?.throwIfAborted();
              // With no caller cancellation, the SDK's total timeout aborted.
              throw new DOMException("Request timed out", "TimeoutError");
            }
            if (
              part.type === "raw" &&
              typeof part.rawValue === "object" &&
              part.rawValue !== null &&
              "type" in part.rawValue
            ) {
              // A bare EOF produces a finish event too, and response.incomplete
              // without a reason can map to "stop". Require the wire completion.
              if (part.rawValue.type === "response.incomplete") {
                throw new Error(
                  "Response was incomplete. Try a smaller diff or a different model.",
                );
              }
              if (part.rawValue.type === "response.completed") completed = true;
            }
            if (part.type === "text-delta") text += part.text;
            if (part.type === "finish") finishReason = part.finishReason;
          }
          if (!completed || finishReason === undefined) {
            throw new StreamInterruptedError();
          }
          if (finishReason !== "stop") {
            throw new Error(
              "Response did not complete successfully. Please try again.",
            );
          }
          if (!text.trim()) throw new NoContentGeneratedError();
        } else {
          const result = await generateText({ ...request, system });
          if (result.finishReason && result.finishReason !== "stop")
            throw new Error(
              "Response did not complete successfully. Increase context.outputTokens or try a different model.",
            );
          text = result.text;
        }

        options?.abortSignal?.throwIfAborted();
        debugLog("ai", "generation succeeded");
        return text;
      } catch (error) {
        if (options?.abortSignal?.aborted) throw error;
        if (!isRetryableError(error) || attempt === maxRetries) {
          const classified = classifyError(
            error,
            this.provider,
            timeoutMs,
            context,
          );
          debugLog("ai", `generation failed: ${classified}`);
          return {
            error: classified,
            code:
              APICallError.isInstance(error) &&
              (error.statusCode === 401 || error.statusCode === 403)
                ? "AUTHENTICATION"
                : "GENERATION",
          };
        }

        options?.onRetry?.(attempt, maxRetries);

        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await delayFn(delayMs);
        return runAttempt(attempt + 1);
      }
    };

    try {
      return await runAttempt(1);
    } finally {
      stopTimer();
    }
  }
}
