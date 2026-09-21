import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Message = { type: string; file?: string };
type Outcome =
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { type: "resumed" };

for (const mode of ["editor", "refinement"] as const) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    test(
      `${signal} during ${mode} ${signal === "SIGTERM" ? "terminates after cleanup without resuming review" : "cancels and resumes review"}`,
      { timeout: 10_000 },
      async (t) => {
        const root = mkdtempSync(join(tmpdir(), "gsmart-interrupt-"));
        const child = fork(
          new URL("../test-support/interrupt-fixture.ts", import.meta.url),
          [mode, root],
          {
            execArgv: [
              "--import",
              new URL("../test-support/register-esmock.mjs", import.meta.url)
                .href,
              "--import",
              "tsx",
            ],
            env: { ...process.env, GSMART_CONFIG_DIR: join(root, "config") },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
          },
        );
        let stderr = "";
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.stdout?.resume();
        let cleaned = false;
        let exited = false;
        const exit = new Promise<void>((resolve) =>
          child.once("exit", () => {
            exited = true;
            resolve();
          }),
        );
        t.after(async () => {
          if (!exited) child.kill("SIGKILL");
          await exit;
          rmSync(root, { recursive: true, force: true });
        });
        const ready = new Promise<Message>((resolve, reject) => {
          child.on("message", (message: Message) => {
            if (message.type === "ready") resolve(message);
            if (message.type === "cleaned") cleaned = true;
          });
          child.once("error", reject);
          child.once("exit", () =>
            reject(new Error(`Fixture exited before ready: ${stderr}`)),
          );
        });
        const outcome = new Promise<Outcome>((resolve) => {
          child.once("exit", (code, exitSignal) =>
            resolve({ type: "exit", code, signal: exitSignal }),
          );
          child.on("message", (message: Message) => {
            if (message.type === "resumed") resolve({ type: "resumed" });
          });
        });
        const { file } = await ready;
        if (file) assert.ok(existsSync(file));
        assert.equal(child.kill(signal), true);
        const result = await outcome;
        assert.equal(
          result.type,
          signal === "SIGTERM" ? "exit" : "resumed",
          stderr,
        );
        if (mode === "editor")
          assert.ok(
            file && !existsSync(file),
            "Editor file must be cleaned up",
          );
        else
          assert.equal(
            cleaned,
            true,
            "In-flight cleanup must finish before shutdown",
          );
      },
    );
  }
}
