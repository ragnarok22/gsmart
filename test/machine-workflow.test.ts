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
import type { GenerationOptions } from "../src/utils/ai.ts";
import type { WorkflowResult } from "../src/utils/workflow-result.ts";

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
