import { readFile, access } from "node:fs/promises";
import path from "node:path";
import type { CommitConventions, ConventionRuleMetadata } from "../definitions";
import { parseConventions, type ConventionLayer } from "./conventions";

// Match commitlint's file priority, but never search outside the Git root.
const configFiles = [
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yaml",
  ".commitlintrc.yml",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  ".commitlintrc.ts",
  ".commitlintrc.cts",
  ".commitlintrc.mts",
  "commitlint.config.ts",
  "commitlint.config.cts",
  "commitlint.config.mts",
];

async function findConfig(root: string): Promise<string | undefined> {
  const manifest = path.join(root, "package.json");
  try {
    const contents: unknown = JSON.parse(await readFile(manifest, "utf8"));
    if (
      contents &&
      typeof contents === "object" &&
      Object.hasOwn(contents, "commitlint")
    )
      return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Cannot read ${manifest} for commitlint configuration. Check that it is readable and contains valid JSON.`,
        { cause: error },
      );
    }
  }
  for (const name of configFiles) {
    const file = path.join(root, name);
    try {
      await access(file);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

type Mapping = { field: string; settings: CommitConventions };

function mapRule(
  name: string,
  condition: unknown,
  value: unknown,
): Mapping | undefined {
  if (condition !== "always" && condition !== "never") return;
  if (name === "type-enum" || name === "scope-enum") {
    if (condition !== "always" || !Array.isArray(value)) return;
    const field = name === "type-enum" ? "types" : "scopes";
    return { field, settings: { [field]: value.length ? value : null } };
  }
  if (
    [
      "header-max-length",
      "subject-max-length",
      "body-max-line-length",
    ].includes(name)
  ) {
    if (condition !== "always" || typeof value !== "number") return;
    const length = value === Infinity ? null : value;
    if (name === "body-max-line-length")
      return {
        field: "body.maxLineLength",
        settings: { body: { maxLineLength: length } },
      };
    const field =
      name === "header-max-length" ? "headerMaxLength" : "subjectMaxLength";
    return { field, settings: { [field]: length } };
  }
  if (name === "scope-empty")
    return {
      field: "scope",
      settings: { scope: condition === "always" ? "forbidden" : "required" },
    };
  if (name === "body-empty")
    return {
      field: "body.presence",
      settings: {
        body: { presence: condition === "always" ? "forbidden" : "required" },
      },
    };
  if (name === "body-leading-blank" || name === "footer-leading-blank") {
    const field = name === "body-leading-blank" ? "body" : "footer";
    return {
      field: `${field}.leadingBlank`,
      settings: { [field]: { leadingBlank: condition === "always" } },
    };
  }
}

export function adaptCommitlintRules(
  rules: Record<string, unknown>,
  source: string,
) {
  const layers: ConventionLayer[] = [];
  const diagnostics: string[] = [];
  for (const [name, rule] of Object.entries(rules)) {
    if (Array.isArray(rule) && rule[0] === 0) continue;
    const [severity, condition, value] = Array.isArray(rule) ? rule : [];
    const mapped = mapRule(name, condition, value);
    if (mapped && (severity === 1 || severity === 2)) {
      try {
        const settings = parseConventions(
          mapped.settings,
          `${source} (${name})`,
        );
        const metadata: ConventionRuleMetadata = { name, severity };
        layers.push({
          settings,
          source,
          ruleMetadata: { [mapped.field]: metadata },
        });
        continue;
      } catch {
        // A valid commitlint rule may use values outside our supported subset.
      }
    }
    diagnostics.push(
      `${source}: ${name} is not imported (unsupported rule or value). See the README commitlint compatibility table.`,
    );
  }
  return { layers, diagnostics };
}

export async function loadCommitlintConventions(root: string) {
  const file = await findConfig(root);
  if (!file) return { layers: [], diagnostics: [], file: undefined };
  try {
    const { default: load } = await import("@commitlint/load");
    const loaded = await load({}, { cwd: root, file });
    return { ...adaptCommitlintRules(loaded.rules, file), file };
  } catch (error) {
    throw new Error(
      `Could not load commitlint configuration ${file}: ${error instanceof Error ? error.message : String(error)}. Check its syntax and install referenced presets/plugins, or set "commitlint": false in .gsmartrc.json.`,
      { cause: error },
    );
  }
}
