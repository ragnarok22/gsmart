export interface ICommand {
  name: string;
  description: string;
  default?: boolean;
  silent?: boolean;
  /** Reuse root generation options without registering shadowing defaults. */
  inheritGenerationOptions?: boolean;
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
  | "plataformia"
  | "custom";

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

export type ContextSettings = {
  budgetTokens?: number | null;
  outputTokens?: number;
  summarize?: boolean;
  maxSummaryRequests?: number;
  exclude?: string[];
  generated?: string[];
};

/** Serializable conventions shared by generation and message validation. */
export type CommitConventions = {
  types?: string[] | null;
  scopes?: string[] | null;
  scope?: "optional" | "required" | "forbidden";
  headerMaxLength?: number | null;
  subjectMaxLength?: number | null;
  language?: string;
  instructions?: string;
  tickets?: {
    prefixes?: string[] | null;
    required?: boolean;
    placement?: "subject" | "body" | "footer";
    footerToken?: string;
  };
  body?: {
    presence?: "optional" | "required" | "forbidden";
    leadingBlank?: boolean;
    maxLineLength?: number | null;
    instructions?: string;
  };
  footer?: { leadingBlank?: boolean };
  breakingChanges?: { requireFooter?: boolean; instructions?: string };
  commitlint?: boolean;
  history?: { enabled?: boolean; limit?: number };
  context?: ContextSettings;
};

export type ResolvedConventions = Required<
  Omit<
    CommitConventions,
    "tickets" | "body" | "footer" | "breakingChanges" | "history" | "context"
  >
> & {
  tickets: Required<NonNullable<CommitConventions["tickets"]>>;
  body: Required<NonNullable<CommitConventions["body"]>>;
  footer: Required<NonNullable<CommitConventions["footer"]>>;
  breakingChanges: Required<NonNullable<CommitConventions["breakingChanges"]>>;
  history: Required<NonNullable<CommitConventions["history"]>>;
  context: Required<ContextSettings>;
};

export type ConventionRuleMetadata = {
  name: string;
  severity: 1 | 2;
};

export type EffectiveConventions = {
  conventions: ResolvedConventions;
  /** Leaf setting paths, such as body.presence, mapped to their winning source. */
  sources: Record<string, string>;
  /** Only effective imported rules; explicit overrides remove imported metadata. */
  ruleMetadata: Record<string, ConventionRuleMetadata>;
  diagnostics: string[];
  root?: string;
  repositoryConfigPath?: string;
  commitlintConfigPath?: string;
};
