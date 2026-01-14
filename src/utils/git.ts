import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import type { GitStatus } from "../definitions";

type RunGitOptions = SpawnSyncOptions & { trim?: boolean };

const runGit = (args: string[], options: RunGitOptions = {}): string => {
  const { trim = true, ...spawnOptions } = options;
  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...spawnOptions,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    throw new Error(stderr || `git ${args.join(" ")}`);
  }

  const output = typeof result.stdout === "string" ? result.stdout : "";
  return trim ? output.trim() : output;
};

export const getGitBranch = async (): Promise<string> => {
  try {
    return runGit(["branch", "--show-current"]);
  } catch {
    return "";
  }
};

export const getGitChanges = async (): Promise<string> => {
  try {
    return runGit(["diff", "--cached"]);
  } catch {
    return "";
  }
};

export const commitChanges = async (message: string): Promise<boolean> => {
  try {
    runGit(["commit", "-m", message]);
    return true;
  } catch {
    return false;
  }
};

const needsSecondaryPath = (statusCode: string): boolean => {
  const normalized = statusCode.replace(/\s/g, "");
  const firstStatus = normalized[0] ?? "";
  return firstStatus === "R" || firstStatus === "C";
};

export const parseGitStatusEntries = (status: string): GitStatus[] => {
  if (!status) {
    return [];
  }

  const entries = status.split("\0").filter((line) => line.length > 0);
  const changedFiles: GitStatus[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const match = entry.match(/^(.{2,4})\s+(.+)$/);

    if (!match) {
      continue;
    }

    const [, rawStatus, filePath] = match;
    const statusCode = rawStatus;
    const statusCodeXY = statusCode.slice(0, 2);
    let currentPath = filePath;
    let originalPath: string | undefined;

    if (needsSecondaryPath(statusCodeXY) && index + 1 < entries.length) {
      originalPath = entries[index + 1];
      currentPath = filePath;
      index += 1;
    }

    changedFiles.push({
      status: statusCode,
      file_name: path.basename(currentPath),
      file_path: currentPath,
      ...(originalPath ? { original_path: originalPath } : {}),
    });
  }

  return changedFiles;
};

export const getGitStatus = async (): Promise<GitStatus[]> => {
  try {
    const status = runGit(["status", "--porcelain", "-z"], { trim: false });
    return parseGitStatusEntries(status);
  } catch (error) {
    console.error("Error getting Git status:", error);
    return [];
  }
};

export const stageFile = async (file: string | string[]): Promise<boolean> => {
  const files = Array.isArray(file) ? file : [file];

  if (files.length === 0) {
    return true;
  }

  try {
    const repoRoot = runGit(["rev-parse", "--show-toplevel"]);
    const absolutePaths = Array.from(
      new Set(files.map((candidate) => path.resolve(repoRoot, candidate))),
    );

    runGit(["add", "--", ...absolutePaths], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
};

export const getGitInfo = async (): Promise<[string, string]> => {
  const branch = await getGitBranch();
  const changes = await getGitChanges();
  return [branch, changes];
};
