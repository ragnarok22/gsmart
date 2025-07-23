import Conf from "conf";
import { Provider, IProvider, ProviderKeys } from "../definitions";
import { providers } from "./ai";

const conf = new Conf({ projectName: "gsmart" });

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
    providers.forEach((provider: IProvider) => {
      keys[provider.value] = this.__get(`${provider.value}.key`);
    });

    return keys;
  }

  private __get(key: string): string {
    return conf.get(key, "");
  }
  private __set(key: string, value: any): void {
    conf.set(key, value);
  }
  private __delete(key: string): void {
    return conf.delete(key);
  }
  public clear(): void {
    return conf.clear();
  }
}

const config = new Config();

export default config;
