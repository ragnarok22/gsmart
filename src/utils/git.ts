import { execSync } from "child_process";

export const getGitBranch = async (): Promise<string> => {
  try {
    const branch = execSync("git branch --show-current").toString().trim();
    return branch;
  } catch (error) {
    return "";
  }
}

export const getGitChanges = async (): Promise<string> => {
  try {
    const changes = execSync("git diff --cached").toString().trim();
    return changes;
  } catch (error) {
    return "";
  }
}

export const commitChanges = async (message: string): Promise<void> => {
  try {
    execSync(`git commit -m "${message}"`);
  } catch (error) {
    console.error("An error occurred while committing the changes");
  }
}
