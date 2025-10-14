import clipboard from "clipboardy";
import chalk from "chalk";
import prompts from "prompts";
import { getGitChanges, getGitStatus, stageFile } from "./git";
import type { GitStatus } from "../definitions";
import { Ora } from "ora";

export { checkForUpdates } from "./version-check";

type RetrieveFilesOptions = {
  autoStage?: boolean;
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
  const paths = files.flatMap((file) => {
    const selections = [file.file_path];
    if (file.original_path) {
      selections.push(file.original_path);
    }
    return selections;
  });

  return Array.from(new Set(paths));
};

export const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await clipboard.write(text);
  } catch {
    console.error("An error occurred while copying the text to the clipboard");
  }
};

export const retrieveFilesToCommit = async (
  spinner: Ora,
  options: RetrieveFilesOptions = {},
): Promise<string | null> => {
  const { autoStage = false } = options;
  let changes = await getGitChanges();

  if (changes.length > 0) {
    return changes;
  }

  const status = await getGitStatus();

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

  let filesToStage: GitStatus[] = [];

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

  const result = await stageFile(pathsToStage);
  if (result) {
    spinner.succeed(chalk.grey("Files staged successfully"));
    changes = await getGitChanges();
  } else {
    spinner.fail(chalk.red("Failed to stage files"));
    return null;
  }

  return changes;
};
