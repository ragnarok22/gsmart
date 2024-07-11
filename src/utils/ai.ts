import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import config from "./config";
import { IProvider, Provider } from "../definitions";
import { DEFAULT_PROVIDER } from "./constants";

export const providers: IProvider[] = [{
  title: "OpenAI",
  value: "openai",
  description: "OpenAI is an artificial intelligence research laboratory consisting of the for-profit OpenAI LP and the non-profit OpenAI Inc.",
  active: true,
}, {
  title: "Anthropic",
  value: "anthropic",
  description: "Anthropic is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
  active: true,
}, {
  title: "Google AI",
  value: "google",
  description: "Google AI is a division of Google dedicated to artificial intelligence.",
  active: false,
}]

/**
 * Build the prompt for the AI model
 * @param branch_name - The current git branch name
 * @param changes - The changes in the current branch
 * @returns - A tuple containing the system and prompt
**/
const buildPrompt = (branch_name: string, changes: string): [string, string] => {
  const system = "You are a professional software engineer working on a project with a team of developers using conventional commit and git flow.";
  const prompt = `Branch: ${branch_name}\nChanges: ${changes}`;
  return [system, prompt];
}

export class AIBuilder {
  provider: Provider;

  constructor(provider: Provider = DEFAULT_PROVIDER) {
    this.provider = provider;
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
  generateCommitMessage(branch_name: string, changes: string) {
    switch (this.provider) {
      case "openai":
        return this._generateOpenAI(branch_name, changes);
      case "anthropic":
        return this._generateAnthropic(branch_name, changes);
      case "google":
        return this._generateGoogle(branch_name, changes);
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
  private async _generateText(model: any, branch_name: string, changes: string): Promise<string | { error: string }> {
    const [system, prompt] = buildPrompt(branch_name, changes);

    try {
      const { text } = await generateText({
        model,
        system,
        prompt
      })

      return text;
    } catch (e) {
      const error = e as Error;
      return {
        error: error.message || "An error occurred while generating the commit message"
      }
    }
  }

  /**
   * Generate a commit message using the OpenAI model
   * @param branch_name - The current git branch name
   * @param changes - The changes in the current branch
   * @returns - The generated commit message
   * @private - This method is private and should not be accessed directly
   * @see https://sdk.vercel.ai/providers/ai-sdk-providers/openai
  **/
  private async _generateOpenAI(branch_name: string, changes: string): Promise<string | { error: string }> {
    const apiKey = config.getOpenAIKey();
    const openai = createOpenAI({
      apiKey,
      compatibility: "strict",
    });
    const model = openai('gpt-3.5-turbo')

    return await this._generateText(model, branch_name, changes);
  }

  /**
   * Generate a commit message using the Anthropic model
   * @param branch_name - The current git branch name
   * @param changes - The changes in the current branch
   * @returns - The generated commit message
   * @private - This method is private and should not be accessed directly
   * @see https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic
  **/
  private async _generateAnthropic(branch_name: string, changes: string): Promise<string | { error: string }> {
    const apiKey = config.getAnthropicKey();
    const anthropic = createAnthropic({
      apiKey,
    });
    const model = anthropic('claude-3-haiku-20240307');

    return await this._generateText(model, branch_name, changes);
  }

  private _generateGoogle(branch_name: string, changes: string) {
    return "Google AI";
  }
}
