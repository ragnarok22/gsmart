import chalk from "chalk";
import { performance } from "node:perf_hooks";

let _enabled = false;
let _startTime = 0;

const sensitiveOptions = new Set(["--api-key"]);

/** Return a logging-only copy, conservatively redacting even after `--`. */
export function redactCommandArgs(args: readonly string[]): string[] {
  return args.map((arg, index) => {
    // Required values can start with '-'. Inspect the original array so adjacent
    // sensitive option names cannot cause a later credential to be overlooked.
    if (index > 0 && sensitiveOptions.has(args[index - 1])) {
      return "[REDACTED]";
    }

    const equalsIndex = arg.indexOf("=");
    if (equalsIndex !== -1 && sensitiveOptions.has(arg.slice(0, equalsIndex))) {
      return `${arg.slice(0, equalsIndex)}=[REDACTED]`;
    }

    return arg;
  });
}

export function enableDebug(): void {
  _enabled = true;
  _startTime = performance.now();
}

export function isDebugEnabled(): boolean {
  return _enabled;
}

export function debugLog(label: string, message: string): void {
  if (!_enabled) return;
  const elapsed = Math.round(performance.now() - _startTime);
  process.stderr.write(
    chalk.dim(`[debug ${label}] +${elapsed}ms ${message}\n`),
  );
}

export function debugTime(label: string): () => void {
  if (!_enabled) return () => {};
  const start = performance.now();
  return () => {
    const elapsed = Math.round(performance.now() - start);
    debugLog(label, `completed in ${elapsed}ms`);
  };
}

export function _resetForTesting(): void {
  _enabled = false;
  _startTime = 0;
}
