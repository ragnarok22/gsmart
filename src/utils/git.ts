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
