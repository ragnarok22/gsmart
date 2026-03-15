import chalk from "chalk";
import { performance } from "node:perf_hooks";

let _enabled = false;
let _startTime = 0;

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
