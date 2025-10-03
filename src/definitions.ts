export interface ICommand {
  name: string;
  description: string;
  default?: boolean;
  options?: Option[];
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

export interface IProvider {
  title: string;
  value: Provider;
  description: string;
  active: boolean;
}

export type ProviderKeys = {
  [key in Provider]?: string;
};

export enum StatusFile {
  Modified = "M",
  Deleted = "D",
  Untracked = "??",
}

export type GitStatus = {
  status: StatusFile;
  file_name: string;
  file_path: string;
};
