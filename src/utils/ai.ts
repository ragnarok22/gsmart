import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import {
  generateText,
  type LanguageModel,
  APICallError,
  NoSuchModelError,
  EmptyResponseBodyError,
  InvalidResponseDataError,
  JSONParseError,
  NoContentGeneratedError,
} from "ai";
import config, { validateApiKey } from "./config";
import { Provider } from "../definitions";
import {
  DEFAULT_PROVIDER,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
} from "./constants";

export { providers, getActiveProviders } from "./providers";

/**
 * Build the prompt for the AI model
 * @param branch_name - The current git branch name
 * @param changes - The changes in the current branch
 * @returns - A tuple containing the system and prompt
 **/
const buildPrompt = (
  branch_name: string,
  changes: string,
): [string, string] => {
  const system = `Role and Objective
Produce commit messages that strictly adhere to the Conventional Commits specification.

# Instructions
- Generate a commit message that includes:
  - **Type** (required): Choose from \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`build\`, \`ci\`, \`chore\`, or \`revert\`.
  - **Scope** (optional): Specify additional context about the affected code area.
  - **Description** (required): Provide a succinct summary of the changes.
- Format: \`<type>(<scope>): <description>\`
  - \`<scope>\` is optional and may be omitted.
- Ensure the commit message fully meets all structure and content criteria before outputting.

# Output Format
- Output only the commit message after it successfully passes all structure and content validation checks. Do not include any validation explanation or checklist.

# Stop Conditions
- Output only the commit message after it successfully passes all structure and content validation checks. No additional text or explanations should be included.`;

  const prompt = `Generate a commit message for these changes on branch ${branch_name}:

Changes:
${changes}

Format: <type>(<scope>): <description>
Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

Examples:
- feat(auth): add login functionality with OAuth
- fix(api): resolve undefined response in user endpoint
- docs(readme): update installation instructions
- style(components): format code according to style guide
- refactor(utils): simplify error handling logic
- perf(queries): optimize database lookups
- test(auth): add unit tests for authentication flow
- build(deps): update dependency versions
- ci(github): add workflow for automated testing
- chore(release): prepare v1.2.0 release
- revert: remove feature flag for beta functionality

Return ONLY the commit message. No explanations or additional text.`;
  return [system, prompt];
};

function classifyError(
  error: unknown,
  provider: string,
  timeoutMs: number,
): string {
  if (error instanceof Error && error.name === "AbortError") {
    return `${provider} - Request timed out after ${timeoutMs / 1000}s. Please check your network connection and try again.`;
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;

    if (status === 401 || status === 403) {
      return `${provider} - Invalid API key. Run \`gsmart login\` to reconfigure.`;
    }

    if (status === 429) {
      return `${provider} - Rate limited by ${provider}. Wait a moment and try again.`;
    }

    if (status === 404) {
      return `${provider} - Model is not available. Check your plan or try a different provider.`;
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
        return `${provider} - Could not reach the ${provider} API. Check your internet connection.`;
      }
    }

    return `${provider} - API request failed (HTTP ${status ?? "unknown"}). Please try again.`;
  }

  if (NoSuchModelError.isInstance(error)) {
    return `${provider} - Model "${error.modelId}" is not available. Check your plan or try a different provider.`;
  }

  if (
    EmptyResponseBodyError.isInstance(error) ||
    InvalidResponseDataError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    NoContentGeneratedError.isInstance(error)
  ) {
    return `${provider} - Unexpected response from ${provider}. Please try again.`;
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
      return `${provider} - Could not reach the ${provider} API. Check your internet connection.`;
    }
  }

  const message =
    error instanceof Error && error.message
      ? error.message
      : "An error occurred while generating the commit message";
  return `${provider} - ${message}`;
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

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;

  if (APICallError.isInstance(error)) {
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

  if (error instanceof TypeError) return true;

  if (error instanceof Error && hasNetworkKeyword(error.message)) return true;

  return false;
}

export type RetryOptions = {
  maxRetries?: number;
  onRetry?: (attempt: number, maxRetries: number) => void;
  delayFn?: (ms: number) => Promise<void>;
};

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  generateCommitMessage(
    branch_name: string,
    changes: string,
    options?: RetryOptions,
  ) {
    const apiKey = config.getKey(this.provider);
    const validationError = validateApiKey(this.provider, apiKey);
    if (validationError) {
      return Promise.resolve({ error: validationError });
    }

    const model = this.__generateModel();
    return this.__generateText(model, branch_name, changes, options);
  }

  private __generateModel(): LanguageModel {
    const apiKey = config.getKey(this.provider);
    switch (this.provider) {
      case "openai": {
        const openai = createOpenAI({
          apiKey,
        });
        return openai("gpt-5-codex");
      }
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey,
        });
        return anthropic("claude-3-5-haiku-latest");
      }
      case "google": {
        const gemini = createGoogleGenerativeAI({
          apiKey,
        });

        return gemini("gemini-2.0-flash");
      }
      case "mistral": {
        const mistral = createMistral({
          apiKey,
        });
        return mistral("mistral-large-latest");
      }
      case "fireworks": {
        const openai = createOpenAI({
          apiKey,
          baseURL: "https://api.fireworks.ai/inference/v1",
        });
        return openai("accounts/fireworks/models/firefunction-v1");
      }
      case "plataformia": {
        const openai = createOpenAI({
          apiKey,
          baseURL: "https://apigateway.avangenio.net",
        });
        return openai("radiance");
      }
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
    options?: RetryOptions,
  ): Promise<string | { error: string }> {
    const [system, initialPrompt] = buildPrompt(branch_name, changes);
    const prompt = this.prompt
      ? `${initialPrompt}

Additional instructions:
${this.prompt}`
      : initialPrompt;

    const timeoutMs = Number(process.env.GSMART_TIMEOUT) || DEFAULT_TIMEOUT_MS;
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const delayFn = options?.delayFn ?? defaultDelay;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { text } = await generateText({
          model,
          system,
          prompt,
          timeout: { totalMs: timeoutMs },
        });

        return text;
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || attempt === maxRetries) {
          return { error: classifyError(error, this.provider, timeoutMs) };
        }

        options?.onRetry?.(attempt, maxRetries);

        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await delayFn(delayMs);
      }
    }

    return { error: classifyError(lastError, this.provider, timeoutMs) };
  }
}
