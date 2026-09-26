import "../test-support/setup-env";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import {
  inspectWorkflowArgs,
  isMachineWorkflow,
} from "../src/utils/generation-options.ts";
import { MAX_DIFF_BYTES, readStdinDiff } from "../src/utils/stdin.ts";
import { createMachineWorkflow } from "../src/commands/machine.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import { dispatchInterrupt } from "../src/utils/interrupt.ts";
import type { GenerationOptions, GenerationError } from "../src/utils/ai.ts";
import {
  writeWorkflowResult,
  type WorkflowResult,
} from "../src/utils/workflow-result.ts";

for (const args of [
  ["--prompt", "--stdin"],
  ["--prompt=--output=json"],
  ["-Dp--output=json"],
  ["--", "--output=json"],
  ["--context-exclude", "--output=json"],
]) {
  test(`bootstrap honors option values and the end-of-options marker: ${args.join(" ")}`, () => {
    assert.equal(isMachineWorkflow(inspectWorkflowArgs(args)), false);
  });
}

test("bootstrap finds output flags after unknown options, aliases, and short clusters", () => {
  for (const args of [
    ["generate", "--unknown", "--output=json"],
    ["-Dp--output=message", "--output", "json"],
    ["--output=json", "generate", "--model"],
  ])
    assert.equal(inspectWorkflowArgs(args).output, "json");
  assert.equal(
    inspectWorkflowArgs(["--output=json", "--output=message"]).output,
    "message",
  );
  assert.equal(inspectWorkflowArgs(["--output"]).output, "message");
});

test("bootstrap identifies planning without mistaking flag values for commands", () => {
  for (const args of [
    ["plan", "--staged"],
    ["--prompt", "instructions", "plan", "--staged"],
    ["plan", "--staged", "--model"],
    ["--", "plan"],
  ])
    assert.equal(inspectWorkflowArgs(args).planning, true);
  for (const args of [
    ["--prompt", "plan"],
    ["-Dpplan"],
    ["generate", "--prompt", "plan"],
  ])
    assert.equal(inspectWorkflowArgs(args).planning, undefined);
});

test("stdin reassembles split Unicode and enforces the capture limit", async () => {
  const data = Buffer.from("café 界😀");
  const signal = new AbortController().signal;
  assert.equal(
    await readStdinDiff(
      signal,
      Readable.from(Array.from(data, (byte) => Buffer.from([byte]))),
    ),
    data.toString(),
  );
  const chunk = Buffer.alloc(1024 * 1024);
  await assert.rejects(
    readStdinDiff(
      signal,
      Readable.from(
        (function* () {
          for (let bytes = 0; bytes <= MAX_DIFF_BYTES; bytes += chunk.length)
            yield chunk;
        })(),
      ),
    ),
    { code: "INPUT", message: /64 MiB/ },
  );
});

test("stdin rejects TTY input, stream errors, and pre-cancellation", async () => {
  const tty = Object.assign(new PassThrough(), { isTTY: true });
  await assert.rejects(readStdinDiff(new AbortController().signal, tty), {
    code: "INPUT",
  });
  tty.destroy();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readStdinDiff(controller.signal, Readable.from([])),
    /aborted/,
  );
  const broken = new PassThrough();
  const reading = readStdinDiff(new AbortController().signal, broken);
  broken.destroy(new Error("stdin failed"));
  await assert.rejects(reading, /stdin failed/);
});

test("stdin accepts an already decoded UTF-8 stream", async () => {
  const input = new PassThrough();
  input.setEncoding("utf8");
  const reading = readStdinDiff(new AbortController().signal, input);
  input.end(Buffer.from("diff --git a/café.ts b/café.ts\n+界😀\n"));
  assert.equal(await reading, "diff --git a/café.ts b/café.ts\n+界😀\n");
});

function machineHarness(
  generated: string | GenerationError = "feat: preserve details",
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const requests: {
    branch: string;
    diff: string;
    prompt: string;
    options?: GenerationOptions;
  }[] = [];
  const committed: string[] = [];
  const snapshot = {
    branch: "feature/fixture",
    diff: "+change",
    fingerprint: "unchanged",
  };
  const run = createMachineWorkflow({
    config: {
      getPrompt: () => "Use the saved personal instructions.",
      getDefaultProvider: () => "anthropic",
      getModel: () => "local",
      getKey: () => "fake",
    } as never,
    loadEffectiveConventions: async ({ user = {}, cli = {} } = {}) => ({
      ...resolveConventions([
        { source: "user", settings: user },
        { source: "CLI", settings: cli },
      ]),
      diagnostics: ["Ignored unsupported commitlint rule: subject-case"],
    }),
    diagnostic: (message) => stderr.push(message + "\n"),
    getStagedSnapshot: async () => snapshot,
    AIBuilder: class {
      constructor(
        _provider: string,
        private prompt: string,
      ) {}
      async generateCommitMessage(
        branch: string,
        diff: string,
        options?: GenerationOptions,
      ) {
        requests.push({ branch, diff, prompt: this.prompt, options });
        return generated;
      }
    },
    commitChanges: async (message) => {
      committed.push(message);
      return false;
    },
    writeResult: (result, format) =>
      writeWorkflowResult(result, format, {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
    setExitCode: (code) => exitCodes.push(code),
  });
  return { run, stdout, stderr, exitCodes, requests, committed };
}

test("machine generation preserves saved instructions and sends configuration diagnostics only to stderr", async () => {
  const app = machineHarness();
  await app.run({ output: "message" });
  assert.deepEqual(app.stdout, ["feat: preserve details\n"]);
  assert.deepEqual(app.stderr, [
    "Ignored unsupported commitlint rule: subject-case\n",
  ]);
  assert.deepEqual(app.exitCodes, [0]);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].prompt, "Use the saved personal instructions.");
  assert.equal(
    app.requests[0].options?.conventions?.instructions,
    app.requests[0].prompt,
  );
  assert.deepEqual(app.committed, []);
});

test("a generation failure without a structured code still produces a GENERATION error", async () => {
  const app = machineHarness({
    error: "Provider failed before returning a result",
  });
  await app.run({ output: "json", commit: true });
  assert.deepEqual(app.exitCodes, [1]);
  assert.deepEqual(app.committed, []);
  assert.equal(app.stdout.length, 1);
  assert.deepEqual(JSON.parse(app.stdout[0]), {
    schemaVersion: 1,
    ok: false,
    error: {
      code: "GENERATION",
      message: "Provider failed before returning a result",
    },
  });
  assert.match(
    app.stderr.join(""),
    /Provider failed before returning a result/,
  );
});

test("a failed commit without a diagnostic retains the candidate and reports a GIT failure", async () => {
  const app = machineHarness();
  await app.run({ output: "json", commit: true });
  assert.deepEqual(app.exitCodes, [1]);
  assert.deepEqual(app.committed, ["feat: preserve details"]);
  assert.equal(app.stdout.length, 1);
  assert.deepEqual(JSON.parse(app.stdout[0]), {
    schemaVersion: 1,
    ok: false,
    message: "feat: preserve details",
    error: {
      code: "GIT",
      message: "Failed to commit changes: Git commit failed.",
    },
  });
  assert.match(app.stderr.join(""), /Git commit failed/);
});

test("machine generation selects the first configured provider and forwards cancellation", async () => {
  const results: WorkflowResult[] = [];
  const exitCodes: number[] = [];
  const providers: string[] = [];
  const run = createMachineWorkflow({
    config: {
      getPrompt: () => "",
      getDefaultProvider: () => undefined,
      getModel: () => "local",
      getKey: () => "fake",
      getOpenAIAuthMode: () => "api-key",
      getOpenAIOAuthTokens: () => null,
    } as never,
    getActiveProviders: () => [
      { value: "openai", title: "OpenAI", active: true, description: "" },
      { value: "anthropic", title: "Anthropic", active: true, description: "" },
    ],
    loadEffectiveConventions: async () => resolveConventions(),
    readStdinDiff: async () => "diff",
    AIBuilder: class {
      constructor(provider: string) {
        providers.push(provider);
      }
      async generateCommitMessage(
        _branch: string,
        _diff: string,
        options?: GenerationOptions,
      ) {
        assert.ok(options?.abortSignal);
        assert.equal(dispatchInterrupt("SIGINT"), true);
        assert.equal(options.abortSignal.aborted, true);
        return "late response";
      }
    },
    writeResult: (result) => results.push(result),
    setExitCode: (code) => exitCodes.push(code),
  });
  await run({ stdin: true, output: "json" });
  assert.deepEqual(providers, ["openai"]);
  assert.deepEqual(exitCodes, [130]);
  assert.equal(results.length, 1);
  assert.ok(!results[0].ok);
  assert.equal(results[0].error.code, "CANCELED");
  assert.equal(dispatchInterrupt("SIGINT"), false);
});
