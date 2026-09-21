import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

type Message = { type: string; file?: string };
type Outcome =
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { type: "resumed" };

const scenarios: {
  mode: "editor" | "refinement";
  signal: "SIGINT" | "SIGTERM";
  cleanCheckout?: boolean;
}[] = [];
for (const mode of ["editor", "refinement"] as const) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    scenarios.push({ mode, signal });
  }
}
scenarios.push({ mode: "refinement", signal: "SIGINT", cleanCheckout: true });

for (const { mode, signal, cleanCheckout } of scenarios) {
  test(
    cleanCheckout
      ? "signal fixture runs from a clean checkout without generated build metadata"
      : `${signal} during ${mode} ${signal === "SIGTERM" ? "terminates after cleanup without resuming review" : "cancels and resumes review"}`,
    { timeout: 10_000 },
    async (t) => {
      const root = mkdtempSync(join(tmpdir(), "gsmart-interrupt-"));
      let fixture = new URL(
        "../test-support/interrupt-fixture.ts",
        import.meta.url,
      );
      let cwd = process.cwd();
      if (cleanCheckout) {
        cwd = join(root, "checkout");
        mkdirSync(cwd);
        for (const file of ["package.json", "tsconfig.json"]) {
          copyFileSync(new URL(`../${file}`, import.meta.url), join(cwd, file));
        }
        cpSync(new URL("../src", import.meta.url), join(cwd, "src"), {
          recursive: true,
          filter: (source) => !source.endsWith("build-info.ts"),
        });
        cpSync(
          new URL("../test-support", import.meta.url),
          join(cwd, "test-support"),
          { recursive: true },
        );
        symlinkSync(
          fileURLToPath(new URL("../node_modules", import.meta.url)),
          join(cwd, "node_modules"),
          "junction",
        );
        assert.equal(existsSync(join(cwd, "src/build-info.ts")), false);
        fixture = pathToFileURL(join(cwd, "test-support/interrupt-fixture.ts"));
      }
      const child = fork(fixture, [mode, root], {
        cwd,
        execArgv: [
          "--import",
          new URL("../test-support/register-esmock.mjs", import.meta.url).href,
          "--import",
          "tsx",
        ],
        env: { ...process.env, GSMART_CONFIG_DIR: join(root, "config") },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
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
      // Simulate a busy parent/CI runner: the operation must remain alive
      // even when the signal is not delivered immediately after "ready".
      await delay(250);
      assert.equal(
        exited,
        false,
        `Fixture exited while awaiting a signal: ${stderr}`,
      );
      assert.equal(child.kill(signal), true);
      const result = await outcome;
      assert.equal(
        result.type,
        signal === "SIGTERM" ? "exit" : "resumed",
        stderr,
      );
      if (signal === "SIGTERM") {
        assert.deepEqual(result, { type: "exit", code: 0, signal: null });
      }
      if (mode === "editor")
        assert.ok(file && !existsSync(file), "Editor file must be cleaned up");
      else
        assert.equal(
          cleaned,
          true,
          "In-flight cleanup must finish before shutdown",
        );
    },
  );
}
