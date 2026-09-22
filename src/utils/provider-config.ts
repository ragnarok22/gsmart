import type { Provider } from "../definitions";
import type config from "./config";
import { validateBaseURL, resolveModel } from "./providers";

type ProviderConfig = Pick<
  typeof config,
  | "getKey"
  | "getModel"
  | "getCustomBaseURL"
  | "getOpenAIAuthMode"
  | "getOpenAIOAuthTokens"
>;

export function usesOpenAIOAuth(
  store: Pick<
    ProviderConfig,
    "getKey" | "getOpenAIAuthMode" | "getOpenAIOAuthTokens"
  >,
): boolean {
  return (
    store.getOpenAIAuthMode() === "oauth" ||
    (!!store.getOpenAIOAuthTokens() && !store.getKey("openai"))
  );
}

export function isProviderConfigured(
  provider: Provider,
  store: ProviderConfig,
  model?: string,
): boolean {
  if (provider === "custom") {
    try {
      validateBaseURL(store.getCustomBaseURL());
      resolveModel(provider, model, store.getModel(provider));
      return true;
    } catch {
      return false;
    }
  }
  if (provider === "openai" && usesOpenAIOAuth(store)) {
    return Boolean(store.getOpenAIOAuthTokens());
  }
  return Boolean(store.getKey(provider)?.trim());
}
