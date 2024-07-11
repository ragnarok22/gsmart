import { execSync } from "child_process";

export const getGitBranch = async (): Promise<string> => {
  try {
    const branch = execSync("git branch --show-current").toString().trim();
    return branch;
  } catch (error) {
    return "";
  }
}
