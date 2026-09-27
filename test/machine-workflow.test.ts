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
import {
  normalizeCommitMessage,
  validateCommitMessage,
} from "../src/utils/commit-message.ts";
import type { EffectiveConventions } from "../src/definitions.ts";
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

test("bootstrap preserves flag-like required values while retaining planning mode", () => {
  const options = inspectWorkflowArgs([
    "plan",
    "--staged",
    "--model",
    "--show-context",
  ]);
  assert.equal(options.planning, true);
  assert.equal(options.model, "--show-context");
});

test("bootstrap missing-value recovery preserves variadic values without replaying them", () => {
  const options = inspectWorkflowArgs([
    "plan",
    "--staged",
    "--context-exclude",
    "src/**",
    "test/**",
    "--model",
  ]);
  assert.equal(options.planning, true);
  assert.deepEqual(options.contextExclude, ["src/**", "test/**"]);
});

test("bootstrap preserves earlier values and output mode when the final value is missing", () => {
  const options = inspectWorkflowArgs([
    "plan",
    "--staged",
    "--prompt",
    "keep this instruction",
    "--prompt",
  ]);
  assert.equal(options.planning, true);
  assert.equal(options.prompt, "keep this instruction");
  assert.equal(
    inspectWorkflowArgs(["plan", "--staged", "--output"]).output,
    "message",
  );
  assert.equal(
    inspectWorkflowArgs(["--output=json", "plan", "--staged", "--output"])
      .output,
    "json",
  );
  assert.equal(
    inspectWorkflowArgs(["--prompt", "plan", "--model"]).planning,
    undefined,
  );
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
  {
    effective,
    commitResult = false,
  }: { effective?: EffectiveConventions; commitResult?: boolean } = {},
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
  let snapshotReads = 0;
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
      ...(effective ??
        resolveConventions([
          { source: "user", settings: user },
          { source: "CLI", settings: cli },
        ])),
      diagnostics: ["Ignored unsupported commitlint rule: subject-case"],
    }),
    diagnostic: (message) => stderr.push(message + "\n"),
    getStagedSnapshot: async () => {
      snapshotReads++;
      return snapshot;
    },
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
      return commitResult;
    },
    writeResult: (result, format) =>
      writeWorkflowResult(result, format, {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
    setExitCode: (code) => exitCodes.push(code),
  });
  return {
    run,
    stdout,
    stderr,
    exitCodes,
    requests,
    committed,
    snapshotReads: () => snapshotReads,
  };
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

for (const output of ["message", "json"]) {
  test(`machine ${output} rejects invalid output before committing`, async () => {
    const candidate = "Here is the message:\n\nfix: preserve details";
    const app = machineHarness(candidate);
    await app.run({ output, commit: true });
    assert.deepEqual(app.committed, []);
    assert.deepEqual(app.exitCodes, [1]);
    assert.match(app.stderr.join(""), /invalid|validation/i);
    if (output === "message") assert.deepEqual(app.stdout, []);
    else {
      const result = JSON.parse(app.stdout[0]);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "VALIDATION");
      assert.equal(result.message, candidate);
      assert.deepEqual(
        result.error.diagnostics,
        validateCommitMessage(candidate).diagnostics,
      );
    }
    assert.equal(app.snapshotReads(), 1);
  });
}

for (const output of ["message", "json"]) {
  for (const candidate of ["", " \r\n\t ", "  feat: leading spaces\r\n"]) {
    test(`machine ${output} retains rejected drafts without printing a message: ${JSON.stringify(candidate)}`, async () => {
      const app = machineHarness(candidate);
      await app.run({ output });
      assert.deepEqual(app.exitCodes, [1]);
      assert.deepEqual(app.committed, []);
      assert.match(app.stderr.join(""), /invalid commit message/i);
      if (output === "message") assert.deepEqual(app.stdout, []);
      else {
        const result = JSON.parse(app.stdout[0]);
        assert.equal(result.error.code, "VALIDATION");
        assert.equal(result.message, normalizeCommitMessage(candidate));
        assert.deepEqual(
          result.error.diagnostics,
          validateCommitMessage(normalizeCommitMessage(candidate)).diagnostics,
        );
      }
    });
  }
}

for (const severity of [1, 2] as const) {
  for (const output of ["message", "json"]) {
    test(`machine ${output} respects imported rule severity ${severity} when committing`, async () => {
      const candidate = "feat: preserve details";
      const effective = resolveConventions([
        {
          source: ".commitlintrc.json",
          settings: { headerMaxLength: 10 },
          ruleMetadata: {
            headerMaxLength: { name: "header-max-length", severity },
          },
        },
      ]);
      const app = machineHarness(candidate, { effective, commitResult: true });
      await app.run({ output, commit: true });
      assert.deepEqual(app.exitCodes, [severity === 1 ? 0 : 1]);
      assert.deepEqual(app.committed, severity === 1 ? [candidate] : []);
      assert.match(app.stderr.join(""), /header-max-length/);
      assert.match(app.stderr.join(""), /\.commitlintrc\.json/);
      if (output === "json") {
        const result = JSON.parse(app.stdout[0]);
        assert.equal(result.ok, severity === 1);
        if (severity === 2) {
          assert.equal(result.error.code, "VALIDATION");
          assert.deepEqual(
            result.error.diagnostics,
            validateCommitMessage(candidate, effective).diagnostics,
          );
        }
      } else
        assert.deepEqual(app.stdout, severity === 1 ? [candidate + "\n"] : []);
    });
  }
}

test("machine normalization agrees across JSON, message output and the final commit", async () => {
  const raw = "feat: preserve details\r\n\r\nKeep a multiline body.\r\n\r\n";
  const normalized = "feat: preserve details\n\nKeep a multiline body.";
  for (const output of ["message", "json"]) {
    const app = machineHarness(raw, { commitResult: true });
    await app.run({ output, commit: true });
    assert.deepEqual(app.exitCodes, [0]);
    assert.deepEqual(app.committed, [normalized]);
    if (output === "json")
      assert.equal(JSON.parse(app.stdout[0]).message, normalized);
    else assert.deepEqual(app.stdout, [normalized + "\n"]);
  }
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
