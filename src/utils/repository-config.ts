import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CommitConventions, EffectiveConventions } from "../definitions";
import { getGitRoot } from "./git";
import { loadCommitlintConventions } from "./commitlint-config";
import { parseConventions, resolveConventions } from "./conventions";

export async function loadRepositoryConfig(cwd = process.cwd()) {
  const root = getGitRoot(cwd);
  if (!root) return { settings: {} as CommitConventions };
  const file = path.join(root, ".gsmartrc.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { root, settings: {} as CommitConventions };
    throw new Error(`Cannot read ${file}. Check the file's permissions.`, {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${file}. Use double-quoted keys and remove comments or trailing commas.`,
      { cause: error },
    );
  }
  return { root, file, settings: parseConventions(value, file) };
}

/** Credentials never enter this resolver, nor its inspectable result. */
export async function loadEffectiveConventions({
  cwd = process.cwd(),
  user = {},
  cli = {},
}: {
  cwd?: string;
  user?: CommitConventions;
  cli?: CommitConventions;
} = {}): Promise<EffectiveConventions> {
  const repository = await loadRepositoryConfig(cwd);
  const layers = [
    { settings: parseConventions(user, "user"), source: "user" },
    { settings: repository.settings, source: repository.file ?? "repository" },
    { settings: parseConventions(cli, "CLI"), source: "CLI" },
  ];
  const useCommitlint =
    cli.commitlint ?? repository.settings.commitlint ?? user.commitlint ?? true;
  const imported =
    repository.root && useCommitlint
      ? await loadCommitlintConventions(repository.root)
      : { layers: [], diagnostics: [], file: undefined };
  const effective = resolveConventions([
    layers[0],
    ...imported.layers,
    ...layers.slice(1),
  ]);
  return {
    ...effective,
    diagnostics: imported.diagnostics,
    root: repository.root,
    repositoryConfigPath: repository.file,
    commitlintConfigPath: imported.file,
  };
}
