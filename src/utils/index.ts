import clipboard from "clipboardy";
import chalk from "chalk";
import prompts from "prompts";
import { getGitChanges, getGitStatus, stageFile, unstageFiles } from "./git";
import type { GitStatus } from "../definitions";
import { Ora } from "ora";
import { debugLog } from "./debug";

export { checkForUpdates } from "./version-check";

type RetrieveFilesOptions = {
  autoStage?: boolean;
  dryRun?: boolean;
};

const normalizeStatus = (status: string): string => status.replace(/\s/g, "");

const formatFileLabel = (file: GitStatus): string => {
  if (file.original_path) {
    return `${file.original_path} → ${file.file_path}`;
  }
  return file.file_name;
};

const formatChoiceTitle = (file: GitStatus): string => {
  const label = formatFileLabel(file);
  const normalized = normalizeStatus(file.status);

  if (normalized === "??") {
    return chalk.green(label);
  }

  if (normalized.includes("D")) {
    return chalk.red(label);
  }

  if (normalized.startsWith("A")) {
    return chalk.green(label);
  }

  if (normalized.startsWith("R")) {
    return chalk.cyan(label);
  }

  return chalk.yellow(label);
};

const collectPathsToStage = (files: GitStatus[]): string[] => {
  const paths = files.map((file) => file.file_path);

  return Array.from(new Set(paths));
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await clipboard.write(text);
    return true;
  } catch {
    debugLog("clipboard", "Failed to copy text to clipboard");
    return false;
  }
};

export const retrieveFilesToCommit = async (
  spinner: Ora,
  options: RetrieveFilesOptions = {},
): Promise<string | null> => {
  const { autoStage = false, dryRun = false } = options;
  let changes = await getGitChanges();

  if (changes.length > 0) {
    return changes;
  }

  let status: GitStatus[];
  try {
    status = await getGitStatus();
  } catch (error) {
    spinner.fail(
      chalk.red(
        `Failed to read git status: ${error instanceof Error ? error.message : error}`,
      ),
    );
    return null;
  }

  if (status.length === 0) {
    spinner.fail(
      chalk.red(
        "No changes found. Please make some changes to your code and add them to the staging area.",
      ),
    );
    return null;
  }

  if (!autoStage) {
    spinner.stop();
  }

  const choices = status.map((file) => ({
    title: formatChoiceTitle(file),
    value: file,
  }));

  let filesToStage: GitStatus[];

  if (autoStage) {
    filesToStage = status;
  } else {
    const response = await prompts({
      type: "multiselect",
      name: "files",
      message: "Select files to stage",
      choices,
    });

    const selected = response.files as GitStatus[] | undefined;

    if (!selected || selected.length === 0) {
      spinner.fail(
        chalk.red("No files selected. Please select files to stage."),
      );
      return null;
    }

    filesToStage = selected;
  }

  const pathsToStage = collectPathsToStage(filesToStage);

  if (dryRun) {
    const staged = await stageFile(pathsToStage);
    if (staged) {
      changes = await getGitChanges();
      const unstaged = await unstageFiles(pathsToStage);
      if (!unstaged) {
        spinner.warn(
          chalk.yellow(
            "Warning: failed to unstage files after dry-run. Files may remain staged.",
          ),
        );
      }
    } else {
      spinner.fail(chalk.red("Failed to stage files"));
      return null;
    }
  } else {
    const staged = await stageFile(pathsToStage);
    if (staged) {
      spinner.succeed(chalk.grey("Files staged successfully"));
      changes = await getGitChanges();
    } else {
      spinner.fail(chalk.red("Failed to stage files"));
      return null;
    }
  }

  return changes;
};
