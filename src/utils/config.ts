import Conf from "conf";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { Provider, ProviderKeys } from "../definitions";
import {
  providers,
  validateProvider,
  validateModel,
  validateBaseURL,
} from "./providers";
import { debugLog } from "./debug";
import { OpenAIOAuthTokens } from "./openai-oauth";

const MIN_KEY_LENGTH = 10;

const providerKeyPrefixes: Partial<Record<Provider, string[]>> = {
  openai: ["sk-"],
  anthropic: ["sk-ant-"],
  google: ["AIza"],
};

/**
 * Validate an API key format for a given provider.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateApiKey(provider: Provider, key: string): string | null {
  if (!key || key.trim().length === 0) {
    return `No API key found for ${provider}. Run \`gsmart login\` to configure your API key.`;
  }

  if (key.trim().length < MIN_KEY_LENGTH) {
    return `API key for ${provider} appears too short. Run \`gsmart login\` to reconfigure your API key.`;
  }

  const trimmedKey = key.trim();
  const prefixes = providerKeyPrefixes[provider];
  if (prefixes && !prefixes.some((prefix) => trimmedKey.startsWith(prefix))) {
    return `API key for ${provider} has an unexpected format (expected prefix: ${prefixes.join(" or ")}). Run \`gsmart login\` to reconfigure your API key.`;
  }

  return null;
}

const createConfigStore = (): Conf => {
  const originalUmask = process.umask();
  try {
    // Conf creates directories synchronously, including its platform-default path.
    // Restrict only newly created directories; existing directories keep their mode.
    process.umask(originalUmask | 0o077);
    const override = process.env.GSMART_CONFIG_DIR;
    const store = new Conf({
      projectName: "gsmart",
      configFileMode: 0o600,
      ...(override ? { cwd: path.resolve(override) } : {}),
    });

    // configFileMode applies to writes, so also protect credentials on read-only startup.
    if (existsSync(store.path)) chmodSync(store.path, 0o600);
    return store;
  } finally {
    process.umask(originalUmask);
  }
};

const conf = createConfigStore();

const completeOAuthTokens = (
  tokens: OpenAIOAuthTokens | null | undefined,
): OpenAIOAuthTokens | null =>
  tokens?.accessToken && tokens.refreshToken && tokens.idToken ? tokens : null;

class Config {
  /** A fresh, read-only provider view for one operation; never cached. */
  getProviderSnapshot() {
    debugLog("config", "read provider preferences snapshot");
    const values = conf.store as Partial<
      Record<Provider, { key?: string; model?: string }>
    > & {
      defaultProvider?: string;
      custom?: { baseURL?: string };
      openai?: {
        authMode?: "api-key" | "oauth";
        oauth?: OpenAIOAuthTokens;
      };
    };

    return {
      getDefaultProvider: (): Provider | undefined =>
        values.defaultProvider
          ? validateProvider(values.defaultProvider)
          : undefined,
      getModel: (provider: Provider): string => values[provider]?.model ?? "",
      getKey: (provider: Provider): string => values[provider]?.key ?? "",
      getCustomBaseURL: (): string => values.custom?.baseURL ?? "",
      getOpenAIAuthMode: (): "api-key" | "oauth" =>
        values.openai?.authMode ?? "api-key",
      getOpenAIOAuthTokens: (): OpenAIOAuthTokens | null =>
        completeOAuthTokens(values.openai?.oauth),
    };
  }

  setDefaultProvider(provider: Provider): void {
    this.__set("defaultProvider", validateProvider(provider));
  }

  getDefaultProvider(): Provider | undefined {
    const value = this.__get("defaultProvider");
    return value ? validateProvider(value) : undefined;
  }

  clearDefaultProvider(): void {
    this.__delete("defaultProvider");
  }

  setModel(provider: Provider, model: string): void {
    this.__set(`${validateProvider(provider)}.model`, validateModel(model));
  }

  getModel(provider: Provider): string {
    return this.__get(`${provider}.model`);
  }

  clearModel(provider: Provider): void {
    this.__delete(`${validateProvider(provider)}.model`);
  }

  setCustomBaseURL(baseURL: string): void {
    this.__set("custom.baseURL", validateBaseURL(baseURL));
  }

  getCustomBaseURL(): string {
    return this.__get("custom.baseURL");
  }

  clearCustomEndpoint(): void {
    this.__delete("custom");
    if (this.getDefaultProvider() === "custom") this.clearDefaultProvider();
  }

  /**
   * Set the API key for the specified provider in the config
   * @param provider - The provider to set the key for
   * @param key - The API key
   * @returns - The API key
   **/
  setKey(provider: Provider, key: string): void {
    return this.__set(`${provider}.key`, key);
  }

  /**
   * Get the API key for the specified provider from the config
   * @param provider - The provider to get the key for
   * @returns - The API key
   **/
  getKey(provider: Provider): string {
    return this.__get(`${provider}.key`);
  }

  /**
   * Clear the API key for the specified provider from the config
   * @param provider - The provider to clear the key for
   * @returns - The API key
   **/
  clearKey(provider: Provider): void {
    return this.__delete(`${provider}.key`);
  }

  setOpenAIOAuthTokens(tokens: OpenAIOAuthTokens): void {
    this.__set("openai.oauth", tokens);
    this.__set("openai.authMode", "oauth");
  }

  getOpenAIOAuthTokens(): OpenAIOAuthTokens | null {
    const tokens = conf.get("openai.oauth", null) as OpenAIOAuthTokens | null;
    return completeOAuthTokens(tokens);
  }

  clearOpenAIOAuthTokens(): void {
    this.__delete("openai.oauth");
  }

  setOpenAIAuthMode(mode: "api-key" | "oauth"): void {
    this.__set("openai.authMode", mode);
  }

  getOpenAIAuthMode(): "api-key" | "oauth" {
    return conf.get("openai.authMode", "api-key") as "api-key" | "oauth";
  }

  /**
   * Get all the API keys from the config
   * @returns - All the API keys
   **/
  getAllKeys(): ProviderKeys {
    const keys: { [key in Provider]?: string } = {};
    providers.forEach((provider) => {
      keys[provider.value] = this.__get(`${provider.value}.key`);
    });

    return keys;
  }

  setPrompt(prompt: string): void {
    return this.__set("defaultPrompt", prompt);
  }

  getPrompt(): string {
    return this.__get("defaultPrompt");
  }

  clearPrompt(): void {
    return this.__delete("defaultPrompt");
  }

  getWelcomeShown(): boolean {
    return (conf.get("welcomeShown", false) as boolean) ?? false;
  }

  setWelcomeShown(val: boolean): void {
    this.__set("welcomeShown", val);
  }

  private __get(key: string): string {
    debugLog("config", `read ${key}`);
    return conf.get<string>(key, "") as string;
  }
  private __set(key: string, value: unknown): void {
    debugLog("config", `write ${key}`);
    conf.set(key, value);
  }
  private __delete(key: string): void {
    debugLog("config", `delete ${key}`);
    return conf.delete(key);
  }
  public clear(): void {
    return conf.clear();
  }
}

const config = new Config();

export default config;
