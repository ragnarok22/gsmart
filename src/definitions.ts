export interface ICommand {
  name: string;
  description: string;
  default?: boolean;
  action: () => void;
}

export type Provider = "openai" | "anthropic" | "google";

export interface IProvider {
  title: string;
  value: Provider;
  description: string;
  active: boolean;
}
