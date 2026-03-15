import Conf from "conf";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Provider, ProviderKeys } from "../definitions";
import { providers } from "./providers";
import { debugLog } from "./debug";

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

  const prefixes = providerKeyPrefixes[provider];
  if (prefixes && !prefixes.some((prefix) => key.startsWith(prefix))) {
    return `API key for ${provider} has an unexpected format (expected prefix: ${prefixes.join(" or ")}). Run \`gsmart login\` to reconfigure your API key.`;
  }

  return null;
}

const resolveConfigDirectory = (): string | undefined => {
  const override = process.env.GSMART_CONFIG_DIR;
  if (!override) {
    return undefined;
  }

  if (!existsSync(override)) {
    mkdirSync(override, { recursive: true });
  }

  return path.resolve(override);
};

const configDirectory = resolveConfigDirectory();

const conf = new Conf({
  projectName: "gsmart",
  ...(configDirectory ? { cwd: configDirectory } : {}),
});

class Config {
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
