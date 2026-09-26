import { stripVTControlCharacters } from "node:util";
import type { Provider } from "../definitions";
import type { ContextRecovery, ContextReport } from "./diff-context";

export type WorkflowErrorCode =
  | "USAGE"
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "INPUT"
  | "NO_INPUT"
  | "CONTEXT"
  | "GENERATION"
  | "GIT"
  | "CANCELED"
  | "INTERNAL";

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly recovery?: ContextRecovery,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export type WorkflowResult = {
  schemaVersion: 1;
} & (
  | {
      ok: true;
      message: string;
      provider: Provider;
      model: string;
      input: { source: "stdin" | "index"; branch: string | null };
      staged: boolean;
      committed: boolean;
      context?: ContextReport;
    }
  | {
      ok: false;
      error: {
        code: WorkflowErrorCode;
        message: string;
        recovery?: ContextRecovery;
      };
      /** Present when a failure occurs after generation, such as a rejected commit. */
      message?: string;
    }
);

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function workflowFailure(
  code: WorkflowErrorCode,
  message: string,
): WorkflowResult & { ok: false } {
  return { schemaVersion: 1, ok: false, error: { code, message } };
}

export function writeWorkflowResult(
  result: WorkflowResult,
  format: string | undefined,
  io = {
    stdout: (text: string) => {
      process.stdout.write(text);
    },
    stderr: (text: string) => {
      process.stderr.write(text);
    },
  },
): void {
  if (format === "json") io.stdout(JSON.stringify(result) + "\n");
  else if (result.ok) io.stdout(result.message.replace(/\n*$/, "") + "\n");
  if (!result.ok)
    io.stderr(`error: ${stripVTControlCharacters(result.error.message)}\n`);
}
