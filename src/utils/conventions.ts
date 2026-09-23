import { Ajv } from "ajv";
import schema from "../../schemas/gsmartrc.schema.json";
import { DEFAULT_CONTEXT, resolveContextBudget } from "./context-budget";
import type {
  CommitConventions,
  ConventionRuleMetadata,
  EffectiveConventions,
  ResolvedConventions,
} from "../definitions";

export const DEFAULT_CONVENTIONS: ResolvedConventions = {
  types: [
    "feat",
    "fix",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ],
  scopes: null,
  scope: "optional",
  headerMaxLength: null,
  subjectMaxLength: null,
  language: "en",
  instructions: "",
  tickets: {
    prefixes: null,
    required: false,
    placement: "footer",
    footerToken: "Refs",
  },
  body: {
    presence: "optional",
    leadingBlank: true,
    maxLineLength: null,
    instructions: "",
  },
  footer: { leadingBlank: true },
  breakingChanges: { requireFooter: false, instructions: "" },
  commitlint: true,
  history: { enabled: false, limit: 5 },
  context: DEFAULT_CONTEXT,
};

const ajv = new Ajv({ allErrors: true });
ajv.addFormat("language-tag", {
  type: "string",
  validate: (value: string) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  },
});
const validate = ajv.compile<CommitConventions>(schema);

export function parseConventions(
  value: unknown,
  source: string,
): CommitConventions {
  if (!validate(value)) {
    const details = validate.errors
      ?.map((error) => {
        const property =
          error.keyword === "additionalProperties"
            ? `/${error.params.additionalProperty}`
            : "";
        const expected =
          error.keyword === "enum"
            ? `; choose ${JSON.stringify(error.params.allowedValues)}`
            : error.keyword === "format"
              ? "; use a language tag such as en, es or pt-BR"
              : "";
        return `${error.instancePath}${property || (error.instancePath ? "" : "/")}: ${error.message}${expected}`;
      })
      .join("; ");
    throw new Error(
      `Invalid conventions in ${source}: ${details}. See schemas/gsmartrc.schema.json for supported settings.`,
    );
  }
  // $schema is editor metadata, not a generation setting.
  const settings = { ...value } as CommitConventions & {
    $schema?: string;
  };
  delete settings.$schema;
  return settings;
}

export type ConventionLayer = {
  settings: CommitConventions;
  source: string;
  ruleMetadata?: Record<string, ConventionRuleMetadata>;
};

/** Layers are ordered from lowest to highest priority. Nested settings merge by leaf. */
export function resolveConventions(
  layers: ConventionLayer[] = [],
): EffectiveConventions {
  const result: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  const ruleMetadata: Record<string, ConventionRuleMetadata> = {};
  const merge = (
    target: Record<string, unknown>,
    values: Record<string, unknown>,
    layer: ConventionLayer,
    prefix = "",
  ) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const field = prefix ? `${prefix}.${key}` : key;
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        target[key] ??= {};
        merge(
          target[key] as Record<string, unknown>,
          value as Record<string, unknown>,
          layer,
          field,
        );
      } else {
        target[key] = structuredClone(value);
        sources[field] = layer.source;
        delete ruleMetadata[field];
        if (layer.ruleMetadata?.[field])
          ruleMetadata[field] = layer.ruleMetadata[field];
      }
    }
  };
  for (const layer of [
    { settings: DEFAULT_CONVENTIONS, source: "built-in" },
    ...layers,
  ]) {
    merge(result, parseConventions(layer.settings, layer.source), layer);
  }
  const conventions = result as ResolvedConventions;
  // Cross-field validation is model-independent only with an explicit budget.
  if (conventions.context.budgetTokens !== null)
    resolveContextBudget("custom", "", conventions.context);
  conventions.language = Intl.getCanonicalLocales(conventions.language)[0];
  if (
    conventions.body.presence === "forbidden" &&
    conventions.tickets.required &&
    conventions.tickets.placement === "body"
  ) {
    throw new Error(
      `Conflicting conventions: body.presence (${sources["body.presence"]}) forbids a body but tickets.placement (${sources["tickets.placement"]}) requires tickets in it. Use tickets.placement: "footer" or allow a body.`,
    );
  }
  return { conventions, sources, ruleMetadata, diagnostics: [] };
}

export type ConventionOptions = {
  prompt?: string;
  language?: string;
  historyExamples?: string;
  contextBudget?: string;
  contextExclude?: string[];
  summarize?: boolean;
};

export function conventionsFromOptions(
  options: ConventionOptions,
): CommitConventions {
  const settings: CommitConventions = {};
  if (options.contextBudget !== undefined) {
    if (!/^\d+$/.test(options.contextBudget))
      throw new Error("--context-budget must be an integer token budget.");
    settings.context = { budgetTokens: Number(options.contextBudget) };
  }
  if (options.contextExclude !== undefined)
    settings.context = { ...settings.context, exclude: options.contextExclude };
  if (options.summarize !== undefined)
    settings.context = { ...settings.context, summarize: options.summarize };
  // Commander supplies an empty default for --prompt; preserve the existing fallback.
  if (options.prompt) settings.instructions = options.prompt;
  if (options.language !== undefined) settings.language = options.language;
  if (options.historyExamples !== undefined) {
    if (!/^(?:[0-9]|1[0-9]|20)$/.test(options.historyExamples)) {
      throw new Error(
        "--history-examples must be an integer from 0 to 20 (0 disables history).",
      );
    }
    const count = Number(options.historyExamples);
    settings.history =
      count === 0 ? { enabled: false } : { enabled: true, limit: count };
  }
  return parseConventions(settings, "CLI options");
}
