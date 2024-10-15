import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import config from "./config";
import { IProvider, Provider } from "../definitions";
import { DEFAULT_PROVIDER } from "./constants";
import { createMistral } from "@ai-sdk/mistral";

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
}, {
  title: "Mistral",
  value: "mistral",
  description: "Mistral is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
  active: true,
}, {
  title: "Fireworks AI",
  value: "fireworks",
  description: "Fireworks AI is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
  active: true,
}, {
  title: "PlataformIA",
  value: "plataformia",
  description: "PlataformIA is a Cuban AI platform offering tools for app creation, workflow automation, and content generation, with APIs for developers.",
  active: true,
}]

export const getActiveProviders = (): IProvider[] => {
  return providers.filter(p => p.active);
}

/**
 * Build the prompt for the AI model
 * @param branch_name - The current git branch name
 * @param changes - The changes in the current branch
 * @returns - A tuple containing the system and prompt
**/
const buildPrompt = (branch_name: string, changes: string): [string, string] => {
  const system = "You are an assistant that helps generate commit messages following the conventional commits style. A commit message should include a type, an optional scope, and a brief description. The types include: feat, fix, docs, style, refactor, perf, test, build, ci, chore, and revert. The scope provides additional context and is optional.";
  const prompt = `Generate a commit message following the conventional commits style for the following changes on branch ${branch_name}:

Branch: ${branch_name}

Changes:
${changes}

Conventional Commits Style:
<type>(<scope>): <description>

Types include: feat, fix, docs, style, refactor, perf, test, build, ci, chore, and revert.
Scopes are optional and provide additional context.

Example:
feat(auth): add user authentication
fix(database): resolve connection timeout issue

Now, generate a commit message for the given changes.
Don't explain the changes, just write a commit message that follows the conventional commits style.",
`;
  return [system, prompt];
}

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
  generateCommitMessage(branch_name: string, changes: string) {
    const model = this.__generateModel();
    return this.__generateText(model, branch_name, changes);
  }

  private __generateModel() {
    const apiKey = config.getKey(this.provider);
    switch (this.provider) {
      case "openai": {
        const openai = createOpenAI({
          apiKey,
          compatibility: "strict",
        });
        return openai('gpt-4o')
      }
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey,
        });
        return anthropic('claude-3-haiku-20240307');
      }
      case "mistral": {
        const mistral = createMistral({
          apiKey,
        });
        return mistral('mistral-large-latest');
      }
      case "fireworks": {
        const openai = createOpenAI({
          apiKey,
          compatibility: "strict",
          baseURL: 'https://api.fireworks.ai/inference/v1',
        });
        return openai('accounts/fireworks/models/firefunction-v1')
      }
      case "plataformia": {
        const openai = createOpenAI({
          apiKey,
          baseURL: "https://apigateway.avangenio.net",
        });
        return openai('radiance');
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
  private async __generateText(model: any, branch_name: string, changes: string): Promise<string | { error: string }> {
    let [system, prompt] = buildPrompt(branch_name, changes);
    if (this.prompt) {
      prompt = `${this.prompt}. The branch name is ${branch_name} and the changes are as follows: ${changes}`;
    }

    try {
      const { text } = await generateText({
        model,
        system,
        prompt,
        maxTokens: 60,
        temperature: 0.7,
      })

      return text;
    } catch (e) {
      const error = e as Error;
      const provider = model.provider.split('.')[0];
      const message = error.message || "An error occurred while generating the commit message";
      return {
        error: `${provider} - ${message}`
      }
    }
  }
}
