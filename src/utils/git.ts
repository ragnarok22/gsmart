import { spawn, spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { GitStatus } from "../definitions";
import { debugLog, debugTime } from "./debug";

type RunGitOptions = SpawnSyncOptions & { trim?: boolean };

const runGit = (args: string[], options: RunGitOptions = {}): string => {
  const { trim = true, ...spawnOptions } = options;
  debugLog("git", `git ${args.join(" ")}`);
  const stopTimer = debugTime("git");

  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...spawnOptions,
  });

  stopTimer();

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

export const getGitRoot = (cwd = process.cwd()): string | undefined => {
  try {
    return runGit(["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    return undefined;
  }
};

/** Bound both retained history and prompt size, even for unusually large subjects. */
export const boundHistoryExamples = (
  subjects: string[],
  limit = 20,
): string[] =>
  subjects
    .slice(0, Math.max(0, Math.min(limit, 20)))
    .map((subject) =>
      stripVTControlCharacters(subject)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200),
    )
    .filter(Boolean);

export async function getRecentCommitSubjects(
  cwd: string,
  limit: number,
): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 0 || limit > 20)
    throw new Error("History limit must be an integer from 0 to 20.");
  if (limit === 0 || !runGit(["rev-parse", "--revs-only", "HEAD"], { cwd }))
    return [];
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "log",
        "--date-order",
        "--no-merges",
        "--no-color",
        "--no-show-signature",
        `-n${limit}`,
        "--format=%s%x00",
        "HEAD",
        "--",
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const subjects: string[] = [];
    let current = "";
    let stderr = "";
    let error: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      // Drain all output but retain at most 200 characters per subject.
      for (const [index, part] of chunk.split("\0").entries()) {
        if (index > 0) {
          if (subjects.length < limit) subjects.push(current);
          current = "";
        }
        const text = current ? part : part.replace(/^\n/, "");
        current += text.slice(0, Math.max(0, 200 - current.length));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk.slice(0, Math.max(0, 4096 - stderr.length));
    });
    child.on("error", (cause: Error) => {
      error ??= cause;
    });
    const onStreamError = (cause: Error) => {
      error ??= cause;
      child.kill();
    };
    child.stdout.on("error", onStreamError);
    child.stderr.on("error", onStreamError);
    child.on("close", (code) => {
      if (error || code !== 0)
        reject(error ?? new Error(stderr || "Could not read Git history."));
      else resolve(boundHistoryExamples(subjects, limit));
    });
  });
}

export const getGitBranch = async (): Promise<string> => {
  try {
    return runGit(["branch", "--show-current"]);
  } catch {
    return "";
  }
};

const MAX_STAGED_DIFF_BYTES = 64 * 1024 * 1024;

/** Read a complete, parser-safe patch without spawnSync's small maxBuffer. */
const readStagedDiff = async (cwd = process.cwd()): Promise<string> => {
  const args = [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--full-index",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-relative",
    "--",
  ];
  debugLog("git", `git ${args.join(" ")}`);
  const stopTimer = debugTime("git");

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stderr = "";
      let error: Error | undefined;
      const fail = (cause: Error) => {
        if (error) return;
        error = cause;
        chunks.length = 0;
        child.kill();
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (error) return;
        bytes += chunk.length;
        if (bytes > MAX_STAGED_DIFF_BYTES) {
          fail(
            new Error(
              "Staged diff exceeds the 64 MiB capture limit. Stage a smaller set of changes and try again.",
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        // Drain the pipe even when the retained diagnostic is full.
        stderr += chunk.slice(0, Math.max(0, 64 * 1024 - stderr.length));
      });
      child.stdout.on("error", fail);
      child.stderr.on("error", fail);
      child.on("error", (cause: Error) => {
        error ??= cause;
        chunks.length = 0;
      });
      // A successful exit alone is insufficient: both pipes must finish too.
      child.on("close", (code, signal) => {
        if (error) {
          reject(error);
        } else if (code !== 0) {
          reject(
            new Error(
              `Failed to read staged Git diff: ${stderr.trim() || (signal ? `terminated by ${signal}` : `git exited with code ${code}`)}`,
            ),
          );
        } else {
          // Decode only after joining chunks so split UTF-8 characters survive.
          resolve(Buffer.concat(chunks, bytes).toString("utf8"));
        }
      });
    });
  } finally {
    stopTimer();
  }
};

export const getGitChanges = async (): Promise<string> => readStagedDiff();

export type StagedSnapshot = {
  branch: string;
  diff: string;
  fingerprint: string;
};

const getStagedIndexFingerprint = async (cwd: string): Promise<string> => {
  const args = ["ls-files", "--stage", "--full-name", "-z"];
  debugLog("git", `git ${args.join(" ")}`);
  const stopTimer = debugTime("git");

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const hash = createHash("sha256");
      let header = "";
      let readingPath = false;
      let hasConflicts = false;
      let stderr = "";
      let error: Error | undefined;

      child.stdout.on("data", (chunk: Buffer) => {
        // Hash raw bytes, including NULs and paths that are not valid UTF-8.
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          if (readingPath) {
            const end = chunk.indexOf(0, offset);
            if (end === -1) break;
            readingPath = false;
            offset = end + 1;
          } else {
            // Only retain the small mode/object/stage header across chunks;
            // paths can contain tabs and newlines and end only at a NUL.
            const end = chunk.indexOf(9, offset);
            if (end === -1) {
              header += chunk.toString("ascii", offset);
              break;
            }
            header += chunk.toString("ascii", offset, end);
            if (/^\d+ [a-f0-9]+ [123]$/.test(header)) hasConflicts = true;
            header = "";
            readingPath = true;
            offset = end + 1;
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        // Keep a bounded diagnostic while continuing to drain the error pipe.
        stderr += chunk.slice(0, Math.max(0, 64 * 1024 - stderr.length));
      });
      child.on("error", (cause: Error) => {
        error ??= cause;
      });
      const onStreamError = (cause: Error) => {
        error ??= cause;
        child.kill();
      };
      child.stdout.on("error", onStreamError);
      child.stderr.on("error", onStreamError);
      // Wait for both process exit and drained pipes, not just stdout's end.
      child.on("close", (code, signal) => {
        if (error) {
          reject(error);
        } else if (code !== 0) {
          reject(
            new Error(
              stderr ||
                `git ${args.join(" ")}${signal ? ` terminated by ${signal}` : ""}`,
            ),
          );
        } else if (hasConflicts) {
          reject(
            new Error(
              "Resolve staged merge conflicts before generating a commit message.",
            ),
          );
        } else {
          resolve(hash.digest("hex"));
        }
      });
    });
  } finally {
    stopTimer();
  }
};

/** Capture the diff and its index/base identity, including binary and mode changes. */
export const getStagedSnapshot = async (): Promise<StagedSnapshot> => {
  const cwd = runGit(["rev-parse", "--show-toplevel"]);
  const identity = async () => {
    const branch = runGit(["branch", "--show-current"], { cwd });
    // --revs-only returns an empty value for an unborn HEAD.
    const head = runGit(["rev-parse", "--revs-only", "HEAD"], { cwd });
    const index = await getStagedIndexFingerprint(cwd);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([branch, head, index]))
      .digest("hex");
    return { branch, fingerprint };
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await identity();
    const diff = await readStagedDiff(cwd);
    const after = await identity();
    if (before.fingerprint === after.fingerprint) return { ...after, diff };
  }
  throw new Error(
    "Staged changes kept changing while being read. Finish staging and try again.",
  );
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
  const status = runGit(["status", "--porcelain", "-z"], { trim: false });
  return parseGitStatusEntries(status);
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

export const unstageFiles = async (
  files: string | string[],
): Promise<boolean> => {
  const paths = Array.isArray(files) ? files : [files];

  if (paths.length === 0) {
    return true;
  }

  try {
    const repoRoot = runGit(["rev-parse", "--show-toplevel"]);
    const absolutePaths = Array.from(
      new Set(paths.map((candidate) => path.resolve(repoRoot, candidate))),
    );

    runGit(["reset", "HEAD", "--", ...absolutePaths], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
};

export const getStagedFileNames = async (): Promise<string[]> => {
  try {
    const output = runGit(["diff", "--cached", "--name-only"]);
    if (!output) return [];
    return output.split("\n").filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

export const parseDiffFileNames = (diff: string): string[] => {
  const regex = /^diff --git a\/.+ b\/(.+)$/gm;
  const names: string[] = [];
  let match;
  while ((match = regex.exec(diff)) !== null) {
    names.push(match[1]);
  }
  return Array.from(new Set(names));
};

export const getGitInfo = async (): Promise<[string, string]> => {
  return Promise.all([getGitBranch(), getGitChanges()]);
};
