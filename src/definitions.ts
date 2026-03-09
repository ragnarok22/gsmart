export interface ICommand {
  name: string;
  description: string;
  default?: boolean;
  options?: Option[];
  arguments?: Argument[];
  action: (args: Record<string, unknown>) => void | Promise<void>;
}

export type Provider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "fireworks"
  | "plataformia";

export type Option = {
  flags: string;
  description: string;
  default?: string | boolean | string[];
};

export type Argument = {
  name: string;
  description: string;
  required?: boolean;
  choices?: string[];
};

export interface IProvider {
  title: string;
  value: Provider;
  description: string;
  active: boolean;
}

export type ProviderKeys = {
  [key in Provider]?: string;
};

export type GitStatus = {
  status: string;
  file_name: string;
  file_path: string;
  original_path?: string;
};
