import "../test-support/setup-env";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import test, { type TestContext } from "node:test";
import type { Scenario } from "../test-support/entrypoint-fixture.ts";
import { temporaryDirectory } from "../test-support/repository.ts";

function start(t: TestContext, scenario: Scenario, args: string[]) {
  const directory = temporaryDirectory(t);
  const child = fork(
    new URL("../test-support/entrypoint-fixture.ts", import.meta.url),
    [JSON.stringify(scenario), ...args],
    {
      execArgv: [
        "--unhandled-rejections=strict",
        "--import",
        "./test-support/register-esmock.mjs",
        "--import",
        "tsx",
      ],
      env: {
        ...process.env,
        GSMART_CONFIG_DIR: directory,
        XDG_CONFIG_HOME: directory,
        NO_UPDATE_NOTIFIER: "1",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stdout = "";
  let stderr = "";
  const events: string[] = [];
  child.stdout!.setEncoding("utf8").on("data", (text: string) => {
    stdout += text;
  });
  child.stderr!.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  const pending = new Map<string, () => void>();
  child.on("message", (event: unknown) => {
    assert.equal(typeof event, "string");
    events.push(event as string);
    pending.get(event as string)?.();
  });
  const done = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
  // A watchdog only bounds failures; readiness and cleanup use IPC, never sleeps.
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 15_000);
  child.once("close", () => clearTimeout(watchdog));
  t.after(async () => {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await done;
  });
  return {
    child,
    events,
    done,
    async waitFor(event: string) {
      if (events.includes(event)) return;
      await Promise.race([
        new Promise<void>((resolve) => pending.set(event, resolve)),
        done.then((result) => {
          assert.fail(`Exited before ${event}: ${JSON.stringify(result)}`);
        }),
      ]);
      pending.delete(event);
    },
  };
}

type Result = Awaited<ReturnType<typeof start>["done"]>;

function assertExit(result: Result, code: number) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, code, result.stderr);
  assert.doesNotMatch(
    result.stderr,
    /[Uu]nhandled(?:Promise)?Rejection|[Uu]ncaughtException|^\w*Error:|^\s+at\s/m,
  );
}

function assertFailure(result: Result, code: string, message: string) {
  assert.equal(result.stdout.trim().split("\n").length, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: false,
    error: { code, message },
  });
  assert.deepEqual(result.stderr.match(/^error:.*$/gm), [`error: ${message}`]);
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  for (const startupFailure of [undefined, "error"] as const) {
    test(`${signal} during a ${startupFailure ? "failing" : "successful"} lazy import cancels once before generation`, async (t) => {
      const app = start(t, { earlySignal: true, startupFailure }, [
        "--output=json",
      ]);
      await app.waitFor("import:waiting");
      assert.equal(app.child.kill(signal), true);
      const result = await app.done;
      assertExit(result, code);
      assertFailure(result, "CANCELED", `Generation canceled by ${signal}.`);
      assert.deepEqual(app.events, [
        "import:started",
        "import:waiting",
        `import:interrupted:${signal}`,
        startupFailure ? "startup:failed" : "import:loaded",
      ]);
    });
  }

  test(`legacy ${signal} during startup exits quietly with status 0`, async (t) => {
    const app = start(t, { earlySignal: true }, []);
    await app.waitFor("import:waiting");
    assert.equal(app.child.kill(signal), true);
    const result = await app.done;
    assertExit(result, 0);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /error:|canceled/i);
    assert.deepEqual(app.events, ["import:started", "import:waiting"]);
  });

  for (const machine of [false, true]) {
    test(`${machine ? "JSON" : "legacy"} ${signal} delegates to the active handler and awaits cleanup`, async (t) => {
      const app = start(
        t,
        { action: "signal" },
        machine ? ["--output=json"] : [],
      );
      await app.waitFor("action:waiting");
      assert.equal(app.child.kill(signal), true);
      await app.waitFor("cleanup:waiting");
      assert.equal(app.child.exitCode, null);
      assert.equal(app.child.signalCode, null);
      app.child.send("cleanup");
      const result = await app.done;
      assertExit(result, machine ? code : 0);
      const resumes = !machine && signal === "SIGINT";
      assert.deepEqual(app.events, [
        "import:started",
        "import:loaded",
        ...(!machine ? ["update", "welcome"] : []),
        "action:started",
        "action:waiting",
        `action:canceled:${signal}`,
        "cleanup:waiting",
        "cleanup:done",
        ...(resumes ? ["review:resumed"] : []),
        ...(machine || resumes ? ["action:done"] : []),
        ...(resumes ? ["holiday"] : []),
      ]);
      if (machine)
        assertFailure(result, "CANCELED", `Generation canceled by ${signal}.`);
      else {
        assert.equal(
          result.stdout,
          `update\nwelcome\n${resumes ? "holiday\n" : ""}`,
        );
        assert.doesNotMatch(result.stderr, /error:|canceled/i);
      }
    });
  }
}

for (const phase of ["startup", "action"] as const) {
  for (const kind of ["error", "value"] as const) {
    for (const machine of [false, true]) {
      test(`${machine ? "JSON" : "legacy"} ${phase} failure preserves a thrown ${kind}`, async (t) => {
        const app = start(
          t,
          phase === "startup" ? { startupFailure: kind } : { action: kind },
          machine ? ["--output=json"] : [],
        );
        const result = await app.done;
        assertExit(result, 1);
        const message = `${phase} failed asynchronously`;
        if (machine)
          assertFailure(
            result,
            phase === "startup" ? "CONFIGURATION" : "INTERNAL",
            message,
          );
        else {
          assert.equal(
            result.stdout,
            phase === "startup" ? "" : "update\nwelcome\n",
          );
          assert.deepEqual(result.stderr.match(/^error:.*$/gm), [
            `error: ${message}`,
          ]);
        }
        assert.deepEqual(app.events, [
          "import:started",
          ...(phase === "action"
            ? [
                "import:loaded",
                ...(!machine ? ["update", "welcome"] : []),
                "action:started",
              ]
            : []),
          `${phase}:failed`,
        ]);
      });
    }
  }
}

test("an action's WorkflowError preserves its explicit error code", async (t) => {
  const app = start(t, { action: "workflow" }, ["--output=json"]);
  const result = await app.done;
  assertExit(result, 1);
  assertFailure(result, "GENERATION", "Provider rejected generation");
  assert.deepEqual(app.events, [
    "import:started",
    "import:loaded",
    "action:started",
  ]);
});

for (const args of [
  ["--help"],
  ["generate", "--help"],
  ["help"],
  ["--version"],
  ["generate", "--version"],
]) {
  test(`${args.join(" ")} with --output json prints normal text without startup notices`, async (t) => {
    const app = start(t, {}, ["--output", "json", ...args]);
    const result = await app.done;
    assertExit(result, 0);
    if (args.includes("--version")) assert.equal(result.stdout, "1.2.3\n");
    else
      assert.match(result.stdout, /^Usage: gsmart(?: generate)? \[options\]/);
    assert.doesNotMatch(result.stdout, /schemaVersion|update|welcome|holiday/);
    assert.doesNotMatch(result.stderr, /error:|update|welcome|holiday/);
    assert.deepEqual(app.events, ["import:started", "import:loaded"]);
  });
}
