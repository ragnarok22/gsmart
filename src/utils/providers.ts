import { IProvider, Provider } from "../definitions";

export const defaultModels: Record<Exclude<Provider, "custom">, string> = {
  openai: "gpt-5.6-luna",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-3.5-flash-lite",
  mistral: "mistral-large-latest",
  fireworks: "accounts/fireworks/models/deepseek-v4-flash",
  plataformia: "radiance",
};

export const OPENAI_OAUTH_DEFAULT_MODEL = "gpt-5-codex";

export const providers: IProvider[] = [
  {
    title: "OpenAI",
    value: "openai",
    description:
      "OpenAI is an artificial intelligence research laboratory consisting of the for-profit OpenAI LP and the non-profit OpenAI Inc.",
    active: true,
  },
  {
    title: "Anthropic",
    value: "anthropic",
    description:
      "Anthropic is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
    active: true,
  },
  {
    title: "Google AI",
    value: "google",
    description:
      "Google AI is a division of Google dedicated to artificial intelligence.",
    active: true,
  },
  {
    title: "Mistral",
    value: "mistral",
    description:
      "Mistral is a French AI company creating open and portable AI models for developers and enterprises.",
    active: true,
  },
  {
    title: "Fireworks AI",
    value: "fireworks",
    description:
      "Fireworks AI is a generative AI inference platform for running and customizing models with speed and efficiency.",
    active: true,
  },
  {
    title: "PlataformIA",
    value: "plataformia",
    description:
      "PlataformIA is a Cuban AI platform offering tools for app creation, workflow automation, and content generation, with APIs for developers.",
    active: true,
  },
  {
    title: "Custom (OpenAI-compatible)",
    value: "custom",
    description:
      "A Chat Completions endpoint, including local Ollama or LM Studio.",
    active: true,
  },
];

export const getActiveProviders = (): IProvider[] => {
  return providers.filter((provider) => provider.active);
};

export function validateProvider(value: string): Provider {
  const provider = getActiveProviders().find((p) => p.value === value);
  if (!provider) {
    throw new Error(
      `Unknown provider "${value}". Choose ${getActiveProviders()
        .map((p) => p.value)
        .join(", ")}.`,
    );
  }
  return provider.value;
}

export function validateModel(value: string): string {
  const model = value.trim();
  if (
    !model ||
    [...model].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    throw new Error(
      "Model must be a non-empty model ID without control characters. Use --model <model>.",
    );
  }
  return model;
}

export function validateBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      "Endpoint must be an absolute HTTP or HTTPS base URL, e.g. http://localhost:11434/v1.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    // search/hash omit bare delimiters; href preserves them.
    /[?#]/.test(url.href)
  ) {
    throw new Error(
      "Endpoint must use HTTP or HTTPS without credentials, a query, or a fragment. Configure authentication separately.",
    );
  }
  if (/\/(chat\/completions|responses)\/*$/.test(url.pathname)) {
    throw new Error(
      "Use the API base URL (e.g. http://localhost:11434/v1), not the /chat/completions or /responses operation URL.",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export function resolveModel(
  provider: Provider,
  override?: string,
  saved?: string,
  oauth = false,
): string {
  if (override !== undefined) return validateModel(override);
  if (saved) return validateModel(saved);
  if (provider === "custom") {
    throw new Error(
      "No model configured for custom. Use `gsmart config --provider custom --model <model>` or --model <model> for this run.",
    );
  }
  return provider === "openai" && oauth
    ? OPENAI_OAUTH_DEFAULT_MODEL
    : defaultModels[provider];
}
