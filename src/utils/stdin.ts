import type { Readable } from "node:stream";
import { WorkflowError } from "./workflow-result";
import { debugLog } from "./debug";

export const MAX_DIFF_BYTES = 64 * 1024 * 1024;

/** Retain complete UTF-8 input, bounded like staged diff capture. */
export async function readStdinDiff(
  signal: AbortSignal,
  input: Readable & { isTTY?: boolean } = process.stdin,
): Promise<string> {
  signal.throwIfAborted();
  if (input.isTTY)
    throw new WorkflowError(
      "INPUT",
      "--stdin requires piped or redirected diff input.",
    );
  debugLog("input", "reading diff from stdin");
  const abort = () => input.destroy(new Error("Input canceled."));
  signal.addEventListener("abort", abort, { once: true });
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of input) {
      signal.throwIfAborted();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_DIFF_BYTES)
        throw new WorkflowError(
          "INPUT",
          "Stdin diff exceeds the 64 MiB capture limit. Supply a smaller diff.",
        );
      chunks.push(buffer);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
