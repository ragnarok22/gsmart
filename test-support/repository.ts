import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=GSmart Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

export function temporaryDirectory(t: TestContext): string {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "gsmart-conventions-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function repository(t: TestContext): string {
  const directory = temporaryDirectory(t);
  git(directory, "init", "-q", "-b", "main");
  return directory;
}
