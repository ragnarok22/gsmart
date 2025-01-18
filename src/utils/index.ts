import clipboard from "clipboardy";
import chalk from "chalk";
import prompts from "prompts";
import { getGitChanges, getGitStatus, stageFile } from "./git";
import { StatusFile } from "../definitions";
import { Ora } from "ora";

export const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await clipboard.write(text);
  } catch (error) {
    console.error("An error occurred while copying the text to the clipboard");
  }
}

export const retrieveFilesToCommit = async (spinner: Ora): Promise<string | null> => {
  let changes = await getGitChanges();

  if (changes.length > 0) {
    return changes;
  }

  // retrieve files with changes
  const status = await getGitStatus();

  if (status.length === 0) {
    spinner.fail(chalk.red("No changes found. Please make some changes to your code and add them to the staging area."));
    return null;
  }

  spinner.stop();

  // get modified files that are not staged
  const changedFiles = status.map(file => {
    if (file.status === StatusFile.Modified) {
      return {
        title: chalk.yellow(file.file_name),
        value: file.file_name,
      };
    } else if (file.status === StatusFile.Deleted) {
      return {
        title: chalk.red(file.file_name),
        value: file.file_name,
      }
    } else if (file.status === StatusFile.Untracked) {
      return {
        title: chalk.green(file.file_name),
        value: file.file_name,
      }
    } else {
      return {
        title: file.file_name,
        value: file.file_name,
      };
    }
  })

  const { files } = await prompts({
    type: "multiselect",
    name: "files",
    message: "Select files to stage",
    choices: changedFiles.map((file) => ({
      title: file.title,
      value: file.value,
    })),
  });

  console.log(files)

  if (!files || files.length === 0) {
    spinner.fail(chalk.red("No files selected. Please select files to stage."));
    return null;
  }

  // staging files to commit
  const result = await stageFile(files);
  if (result) {
    spinner.succeed(chalk.grey("Files staged successfully"));
    changes = await getGitChanges();
  } else {
    spinner.fail(chalk.red("Failed to stage files"));
    return null;
  }

  return changes;
}
