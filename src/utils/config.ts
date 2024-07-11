import Conf from "conf";

const conf = new Conf({ projectName: "gsmart" })

class Config {
  getOpenAIKey() {
    return this.__get("openai.key") || "";
  }

  setOpenAIKey(key: string) {
    return this.__set("openai.key", key);
  }

  clearOpenAIKey() {
    return this.__delete("openai.key");
  }

  getAnthropicKey() {
    return this.__get("anthropic.key") || "";
  }

  setAnthropicKey(key: string) {
    return this.__set("anthropic.key", key);
  }

  clearAnthropicKey() {
    return this.__delete("anthropic.key");
  }

  getMistralKey() {
    return this.__get("mistral.key")
  }

  setMistralKey(key: string) {
    return this.__set("mistral.key", key);
  }

  clearMistralKey() {
    return this.__delete("mistral.key");
  }

  getAllKeys() {
    const keys = {
      openai: this.getOpenAIKey() as string,
      anthropic: this.getAnthropicKey() as string,
      mistral: this.getMistralKey() as string,
    }

    // return null if all keys are empty
    if (!Object.values(keys).some(Boolean)) {
      return null;
    }

    return keys;
  }

  private __get(key: string) {
    return conf.get(key);
  }
  private __set(key: string, value: any) {
    return conf.set(key, value);
  }
  private __delete(key: string) {
    return conf.delete(key);
  }
  public clear() {
    return conf.clear();
  }
}

const config = new Config();

export default config;
