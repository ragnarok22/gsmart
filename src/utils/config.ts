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

  getAllKeys() {
    return {
      openai: this.getOpenAIKey(),
      anthropic: this.getAnthropicKey()
    }
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
