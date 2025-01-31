import { execSync } from "child_process";
import path from "path";
import { GitStatus, StatusFile } from "../definitions";

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

export const commitChanges = async (message: string): Promise<boolean> => {
  try {
    execSync(`git commit -m "${message}"`);
    return true;
  } catch (e) {
    return false;
  }
}

export const getGitStatus = async (): Promise<GitStatus[]> => {
  try {
    const status = execSync('git status --porcelain -z').toString();

    const files = status.split('\0').filter((line) => line.trim().length > 0);

    const changedFiles = files.map((f) => {
      const match = f.trim().match(/^(\S{1,2})\s+(.+)$/);

      if (!match) {
        throw new Error(`Error parsing file status: ${f}`);
      }

      const [, status, fullPath] = match;
      const file_name = path.basename(fullPath) as string;

      return {
        status: status.trim() as StatusFile,
        file_name,
        file_path: fullPath
      };
    });

    return changedFiles;
  } catch (error) {
    console.error('Error getting Git status:', error);
    return [];
  }
};


export const stageFile = async (file: string | string[]): Promise<boolean> => {
  const files = Array.isArray(file) ? file.join(" ") : file;

  try {
    execSync(`git add ${files}`);
    return true;
  } catch (error) {
    return false;
  }
}

export const getGitInfo = async (): Promise<[string, string]> => {
  const branch = await getGitBranch();
  const changes = await getGitChanges();
  return [branch, changes];
}
