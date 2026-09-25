import type { ContextSettings, Provider } from "../definitions";

export const DEFAULT_CONTEXT: Required<ContextSettings> = {
  budgetTokens: null,
  outputTokens: 1024,
  summarize: false,
  maxSummaryRequests: 8,
  exclude: [],
  generated: [
    "**/*.min.js",
    "**/*.min.css",
    "**/*.map",
    "**/*.generated.*",
    "**/generated/**",
    "**/dist/**",
  ],
};

// Exact IDs only: new/private models and mutable aliases use the fallback.
// Deliberately cap our default below the advertised window to control cost.
const MODEL_WINDOWS: Partial<Record<Provider, Record<string, number>>> = {
  openai: { "gpt-4o": 128_000, "gpt-4o-mini": 128_000, "gpt-5-codex": 400_000 },
  anthropic: { "claude-haiku-4-5-20251001": 200_000 },
  google: { "gemini-2.5-flash": 1_048_576, "gemini-2.5-pro": 1_048_576 },
};

export const REQUEST_OVERHEAD = 512;
export const FALLBACK_BUDGET = 8192;
export const MAX_AUTOMATIC_BUDGET = 32_768;
export const MAX_CONTEXT_BUDGET = 1_048_576;

/** Conservative accounting: one token per UTF-8 byte, not chars / 4.
 * Byte-fallback tokenizers encode text in no more tokens than bytes. Custom
 * tokenizers/server-added templates may differ; allow an explicit lower budget.
 */
export const estimateTokens = (text: string): number => Buffer.byteLength(text);

export type ContextBudget = ReturnType<typeof resolveContextBudget>;

export function resolveContextBudget(
  provider: Provider,
  model: string,
  settings: ContextSettings = {},
) {
  const resolved = { ...DEFAULT_CONTEXT, ...settings };
  const models = MODEL_WINDOWS[provider];
  const window =
    models && Object.hasOwn(models, model) ? models[model] : undefined;
  const total =
    resolved.budgetTokens ??
    (window ? Math.min(window, MAX_AUTOMATIC_BUDGET) : FALLBACK_BUDGET);
  if (
    !Number.isSafeInteger(total) ||
    total < 1024 ||
    total > MAX_CONTEXT_BUDGET
  )
    throw new Error(
      "context.budgetTokens must be an integer from 1024 to 1048576.",
    );
  if (window && total > window)
    throw new Error(
      `context.budgetTokens exceeds the known ${model} context window (${window}).`,
    );
  if (
    !Number.isSafeInteger(resolved.outputTokens) ||
    resolved.outputTokens < 256 ||
    resolved.outputTokens > 32_768
  )
    throw new Error(
      "context.outputTokens must be an integer from 256 to 32768.",
    );
  if (resolved.outputTokens + REQUEST_OVERHEAD >= total)
    throw new Error(
      "Context budget must leave room for input after context.outputTokens and request overhead.",
    );
  if (
    !Number.isSafeInteger(resolved.maxSummaryRequests) ||
    resolved.maxSummaryRequests < 1 ||
    resolved.maxSummaryRequests > 64
  )
    throw new Error(
      "context.maxSummaryRequests must be an integer from 1 to 64.",
    );
  return {
    total,
    modelWindow: window,
    maxTotal: Math.min(window ?? MAX_CONTEXT_BUDGET, MAX_CONTEXT_BUDGET),
    input: total - resolved.outputTokens - REQUEST_OVERHEAD,
    output: resolved.outputTokens,
    overhead: REQUEST_OVERHEAD,
    source:
      resolved.budgetTokens != null
        ? "override"
        : window
          ? "model"
          : "fallback",
    settings: resolved,
  };
}

export type ContextRequest = { system: string; prompt: string };

export function assertRequestFits(
  request: ContextRequest,
  budget: ContextBudget,
) {
  if (
    estimateTokens(request.system) + estimateTokens(request.prompt) >
    budget.input
  )
    throw new Error(
      "AI request exceeds the context budget. Increase --context-budget or shorten instructions, history, or refinement feedback.",
    );
}

/** A byte-limited prefix that never splits a Unicode code point. */
export function bytePrefix(text: string, bytes: number): string {
  if (bytes <= 0) return "";
  // A UTF-8 prefix of N bytes cannot contain more than N UTF-16 code units.
  // Bound the conversion first, so a short excerpt never copies a huge line.
  const prefix = text.slice(0, bytes);
  const buffer = Buffer.from(prefix);
  if (buffer.length <= bytes) return prefix;
  let end = bytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}
