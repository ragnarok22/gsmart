import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withInterruptHandler } from "./interrupt";

export type EditResult =
  | { status: "edited"; message: string }
  | { status: "cancelled" }
  | { status: "error"; error: string };

type EditorExit = { code: number | null; signal: NodeJS.Signals | null };

export const runEditor = async (
  command: string,
  file: string,
  platform: NodeJS.Platform,
): Promise<EditorExit> => {
  let child: ChildProcess | undefined;
  let interrupted: NodeJS.Signals | null = null;
  return withInterruptHandler(
    (signal) => {
      interrupted = signal;
      child?.kill(signal);
    },
    () =>
      new Promise<EditorExit>((resolve, reject) => {
        // Editor configuration is a user-supplied command. On POSIX, pass the
        // filename separately so the shell never interprets it or the message.
        child =
          platform === "win32"
            ? spawn(
                process.env.ComSpec || "cmd.exe",
                ["/d", "/s", "/c", `"${command} "${file}""`],
                {
                  stdio: "inherit",
                  windowsVerbatimArguments: true,
                },
              )
            : spawn(
                "/bin/sh",
                ["-c", `exec ${command} "$1"`, "gsmart-editor", file],
                {
                  stdio: "inherit",
                },
              );
        child.once("error", reject);
        child.once("close", (code, signal) =>
          resolve({ code, signal: interrupted ?? signal }),
        );
      }),
  );
};

type EditorDeps = {
  env: () => NodeJS.ProcessEnv;
  platform: () => NodeJS.Platform;
  tempDirectory: () => string;
  runEditor: typeof runEditor;
};

export const createMessageEditor = (overrides: Partial<EditorDeps> = {}) => {
  const deps: EditorDeps = {
    env: () => process.env,
    platform: () => process.platform,
    tempDirectory: tmpdir,
    runEditor,
    ...overrides,
  };

  return async (currentMessage: string): Promise<EditResult> => {
    const env = deps.env();
    const platform = deps.platform();
    const command =
      env.VISUAL?.trim() ||
      env.EDITOR?.trim() ||
      (platform === "win32" ? "notepad" : "vi");
    let directory: string | undefined;
    let result: EditResult;
    try {
      directory = mkdtempSync(join(deps.tempDirectory(), "gsmart-message-"));
      const file = join(directory, "COMMIT_EDITMSG");
      writeFileSync(file, `${currentMessage}\n`, { mode: 0o600 });
      const exit = await deps.runEditor(command, file, platform);
      if (exit.signal || exit.code === 130 || exit.code === 143) {
        result = { status: "cancelled" };
      } else if (exit.code !== 0) {
        throw new Error(
          `Editor "${command}" exited with status ${exit.code ?? "unknown"}.`,
        );
      } else {
        const message = readFileSync(file, "utf8")
          .replace(/\r\n?/g, "\n")
          .trim();
        if (!message) throw new Error("The edited message is empty.");
        result =
          message === currentMessage.replace(/\r\n?/g, "\n").trim()
            ? { status: "cancelled" }
            : { status: "edited", message };
      }
    } catch (error) {
      result = {
        status: "error",
        error: `${error instanceof Error ? error.message : String(error)} Current candidate kept. Set VISUAL or EDITOR to an installed editor (use --wait for GUI editors), then try Edit again.`,
      };
    }
    if (directory) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        result = {
          status: "error",
          error: `Could not remove editor temporary directory ${directory}. Current candidate kept. Close the editor, remove the directory, and try Edit again.`,
        };
      }
    }
    return result;
  };
};

export const editMessage = createMessageEditor();
