export interface ICommand {
  name: string;
  description: string;
  default?: boolean;
  options?: Option[];
  action: (args: any) => void;
}

export type Provider = "openai" | "anthropic" | "google" | "mistral" | "fireworks";

export type Option = {
  flags: string;
  description: string;
  default?: string | boolean | string[];
}


export interface IProvider {
  title: string;
  value: Provider;
  description: string;
  active: boolean;
}

export type ProviderKeys = {
  [key in Provider]?: string;
};
