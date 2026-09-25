import "../test-support/setup-env";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import schema from "../schemas/generation-result.schema.json";
import {
  git,
  repository,
  temporaryDirectory,
} from "../test-support/repository.ts";
import { sourceDiff } from "../test-support/diff-fixtures.ts";
import type { WorkflowResult } from "../src/utils/workflow-result.ts";

const validate = new Ajv().compile<WorkflowResult>(schema);
const message = "feat: support café 界😀\n\nPreserve multiline output.";
const diff = sourceDiff("src/café.ts", 1);
const entry =
  process.env.GSMART_TEST_CLI_ENTRY ??
  fileURLToPath(new URL("../src/index.ts", import.meta.url));

async function setup(
  t: TestContext,
  {
    outside = false,
    configured = true,
    status = 200,
    text = message,
    onRequest,
    hold = false,
  }: {
    outside?: boolean;
    configured?: boolean;
    status?: number;
    text?: string;
    onRequest?: () => void;
    hold?: boolean;
  } = {},
) {
  const cwd = outside ? temporaryDirectory(t) : repository(t);
  const store = temporaryDirectory(t);
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    onRequest?.();
    if (hold) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        status === 200
          ? {
              id: "test",
              object: "chat.completion",
              created: 1,
              model: "local",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: text },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20,
              },
            }
          : { error: { message: "rejected by test server" } },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const settings = configured
    ? {
        defaultProvider: "custom",
        custom: {
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          model: "local",
        },
      }
    : {};
  writeFileSync(join(store, "config.json"), JSON.stringify(settings));

  function start(
    args: string[],
    input: string | null = "",
    env: NodeJS.ProcessEnv = {},
    directory = cwd,
  ) {
    const child = spawn(
      process.execPath,
      [
        ...(entry.endsWith(".ts")
          ? ["--import", import.meta.resolve("tsx")]
          : []),
        entry,
        ...args,
      ],
      {
        cwd: directory,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          GSMART_CONFIG_DIR: store,
          XDG_CONFIG_HOME: store,
          FORCE_COLOR: "0",
          NO_UPDATE_NOTIFIER: "1",
          SHELL: "/bin/bash",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "GSmart Test",
          GIT_COMMITTER_NAME: "GSmart Test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_EMAIL: "test@example.com",
          ...env,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    // Early usage/config failures may close stdin before the caller finishes.
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
    if (input !== null) child.stdin.end(input);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
    t.after(() => {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const done = once(child, "close").then(([code, signal]) => {
      clearTimeout(timeout);
      assert.equal(signal, null, `CLI hung or crashed: ${stderr}`);
      return { code: code as number, stdout, stderr };
    });
    return { child, done };
  }
  return {
    cwd,
    store,
    requests,
    start,
    run: (
      args: string[],
      input = "",
      env?: NodeJS.ProcessEnv,
      directory?: string,
    ) => start(args, input, env, directory).done,
  };
}

function json(output: { stdout: string; stderr: string }): WorkflowResult {
  const result = JSON.parse(output.stdout);
  assert.ok(validate(result), JSON.stringify(validate.errors));
  assert.equal(output.stdout.trim().split("\n").length, 1);
  return result;
}

function stageFixture(cwd: string) {
  writeFileSync(join(cwd, "changed.txt"), "staged content");
  git(cwd, "add", "changed.txt");
  writeFileSync(join(cwd, "changed.txt"), "unstaged content");
  writeFileSync(join(cwd, "untracked.txt"), "untracked content");
}

for (const prefix of [[], ["generate"]]) {
  test(`message output is exact and generation preserves a partial index (${prefix.join("") || "root"})`, async (t) => {
    const app = await setup(t);
    stageFixture(app.cwd);
    const index = readFileSync(join(app.cwd, ".git/index"));
    const result = await app.run([...prefix, "--output", "message"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, message + "\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(readFileSync(join(app.cwd, ".git/index")), index);
    assert.equal(git(app.cwd, "rev-parse", "--revs-only", "HEAD"), "");
    assert.equal(
      readFileSync(join(app.cwd, "changed.txt"), "utf8"),
      "unstaged content",
    );
    assert.doesNotMatch(
      JSON.stringify(app.requests),
      /unstaged content|untracked content/,
    );
    assert.equal(
      JSON.parse(readFileSync(join(app.store, "config.json"), "utf8"))
        .welcomeShown,
      undefined,
    );
  });
}

test("stdin supports repo-less generation, optional branch metadata, JSON, and debug on stderr", async (t) => {
  const app = await setup(t, { outside: true });
  for (const branch of [undefined, "feature/ISSUE-494"]) {
    const result = await app.run(
      [
        "--stdin",
        "--output=json",
        "--debug",
        ...(branch ? ["--branch", branch] : []),
      ],
      diff,
    );
    assert.equal(result.code, 0, result.stderr);
    const value = json(result);
    assert.ok(value.ok);
    assert.equal(value.message, message);
    assert.deepEqual(value.input, { source: "stdin", branch: branch ?? null });
    assert.equal(value.committed, false);
    assert.equal(value.staged, false);
    assert.match(result.stderr, /\[debug cli\]/);
    assert.doesNotMatch(result.stdout, /\[debug|Quick start|Update available/);
  }
  assert.match(JSON.stringify(app.requests[1]), /feature\/ISSUE-494/);
  assert.match(JSON.stringify(app.requests[0]), /café/);
  const result = await app.run(["--stdin"], diff);
  assert.equal(result.stdout, message + "\n");
  assert.equal(existsSync(join(app.cwd, ".git")), false);
});

test("context reports stay inside JSON or on stderr for message output", async (t) => {
  const app = await setup(t, { outside: true });
  for (const format of ["message", "json"]) {
    const result = await app.run(
      ["--stdin", "--output", format, "--show-context"],
      sourceDiff(),
    );
    assert.equal(result.code, 0, result.stderr);
    if (format === "json") {
      const value = json(result);
      assert.ok(value.ok && value.context);
      assert.equal(value.context.files[0].treatment, "condensed");
      assert.equal(result.stderr, "");
    } else {
      assert.equal(result.stdout, message + "\n");
      assert.match(result.stderr, /"treatment": "condensed"/);
    }
  }
});

for (const args of [
  ["--output", "json", "--yes"],
  ["--dry-run", "--output=json"],
  ["--stdin", "--commit", "--output=json"],
  ["--stdin", "--stage", "--output=json"],
  ["--unknown", "--output=json"],
  ["--output=json", "--model"],
  ["--output=json", "--branch", ""],
  ["--output=json", "--provider", "bogus"],
  ["--output=json", "config", "--show"],
  ["generate", "--output=json", "unexpected"],
]) {
  test(`invalid machine arguments return JSON and status 2: ${args.join(" ")}`, async (t) => {
    const app = await setup(t);
    stageFixture(app.cwd);
    const index = readFileSync(join(app.cwd, ".git/index"));
    const result = await app.run(args, diff);
    assert.equal(result.code, 2, result.stderr);
    const value = json(result);
    assert.ok(!value.ok);
    assert.equal(value.error.code, "USAGE");
    assert.match(result.stderr, /error:/);
    assert.deepEqual(readFileSync(join(app.cwd, ".git/index")), index);
    assert.equal(app.requests.length, 0);
  });
}

test("invalid format has empty stdout and usage diagnostics", async (t) => {
  const app = await setup(t);
  const result = await app.run(["--output", "yaml"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /message or json/);
  const missing = await app.run(["--output"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /argument missing/);
});

for (const output of ["message", "json"]) {
  test(`missing configuration is prompt-free (${output})`, async (t) => {
    const app = await setup(t, { configured: false, outside: true });
    // Leave stdin open: missing configuration must be reported before reading.
    const result = await app.start(["--stdin", "--output", output], null).done;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No configured providers.*gsmart login/);
    if (output === "json") {
      const value = json(result);
      assert.ok(!value.ok);
      assert.equal(value.error.code, "CONFIGURATION");
    } else assert.equal(result.stdout, "");
  });
}

test("configuration import failures also use the JSON envelope", async (t) => {
  const app = await setup(t, { outside: true });
  writeFileSync(join(app.store, "config.json"), "{invalid");
  const result = await app.run(["--output=json", "--stdin"], diff);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "CONFIGURATION");
});

test("repository configuration diagnostics cannot contaminate JSON or stage files", async (t) => {
  const app = await setup(t);
  stageFixture(app.cwd);
  writeFileSync(
    join(app.cwd, "commitlint.config.cjs"),
    'console.log("config loader diagnostic"); module.exports = { rules: {} };',
  );
  const success = await app.run(["--output=json"]);
  assert.equal(success.code, 0, success.stderr);
  assert.ok(json(success).ok);
  assert.match(success.stderr, /config loader diagnostic/);
  const index = readFileSync(join(app.cwd, ".git/index"));
  writeFileSync(join(app.cwd, ".gsmartrc.json"), '{"history":{"limit":100}}');
  const failed = await app.run(["--output=json", "--stage"]);
  assert.equal(failed.code, 1);
  const value = json(failed);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "CONFIGURATION");
  assert.deepEqual(readFileSync(join(app.cwd, ".git/index")), index);
});

test("machine generation honors repository history and per-invocation provider/model/convention overrides", async (t) => {
  const app = await setup(t);
  writeFileSync(join(app.cwd, "base.txt"), "base");
  git(app.cwd, "add", "base.txt");
  git(app.cwd, "commit", "-m", "feat(api): preserve repository style");
  stageFixture(app.cwd);
  writeFileSync(
    join(app.cwd, ".gsmartrc.json"),
    '{"language":"es","history":{"enabled":true,"limit":1}}',
  );
  const result = await app.run([
    "--output=json",
    "--provider",
    "custom",
    "--model",
    "invocation-model",
    "--prompt",
    "Explain behavior changes.",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const value = json(result);
  assert.ok(value.ok);
  assert.equal(value.model, "invocation-model");
  assert.equal(app.requests[0].model, "invocation-model");
  const request = JSON.stringify(app.requests[0]);
  assert.match(request, /preserve repository style/);
  assert.match(request, /language es/);
  assert.match(request, /Explain behavior changes/);
});

test("an explicitly selected unconfigured provider fails without waiting for stdin", async (t) => {
  const app = await setup(t, { configured: false, outside: true });
  const result = await app.start(
    ["--stdin", "--output=json", "--provider", "anthropic"],
    null,
  ).done;
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "AUTHENTICATION");
  assert.match(value.error.message, /gsmart login/);
});

test("empty input and Git read errors have explicit error codes", async (t) => {
  const app = await setup(t, { outside: true });
  for (const [args, code] of [
    [["--stdin"], "NO_INPUT"],
    [[], "GIT"],
  ] as const) {
    const result = await app.run(["--output=json", ...args]);
    assert.equal(result.code, 1);
    const value = json(result);
    assert.ok(!value.ok);
    assert.equal(value.error.code, code);
  }
  assert.equal(app.requests.length, 0);
});

test("an empty index never causes implicit staging", async (t) => {
  const app = await setup(t);
  writeFileSync(join(app.cwd, "untracked.txt"), "change");
  const result = await app.run(["--output=json"]);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "NO_INPUT");
  assert.equal(existsSync(join(app.cwd, ".git/index")), false);
  assert.equal(app.requests.length, 0);
});

for (const [status, code] of [
  [401, "AUTHENTICATION"],
  [400, "GENERATION"],
] as const) {
  test(`provider HTTP ${status} returns ${code} and preserves the index`, async (t) => {
    const app = await setup(t, { status });
    stageFixture(app.cwd);
    const index = readFileSync(join(app.cwd, ".git/index"));
    const result = await app.run(["--output=json"]);
    assert.equal(result.code, 1);
    const value = json(result);
    assert.ok(!value.ok);
    assert.equal(value.error.code, code);
    assert.deepEqual(readFileSync(join(app.cwd, ".git/index")), index);
  });
}

test("empty generation fails instead of printing an empty success", async (t) => {
  const app = await setup(t, { outside: true, text: " " });
  const result = await app.run(["--stdin", "--output=json"], diff);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "GENERATION");
});

test("metadata overflow includes recovery data without prompting or retrying", async (t) => {
  const app = await setup(t, { outside: true });
  const input = Array.from({ length: 150 }, (_, i) =>
    sourceDiff(`file-${i}.ts`, 1),
  ).join("");
  const result = await app.run(["--stdin", "--output=json"], input);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "CONTEXT");
  assert.ok(value.error.recovery?.suggestedBudgetTokens);
  assert.doesNotMatch(result.stderr, /for this session and retry\?/);
  assert.equal(app.requests.length, 0);
});

test("staging and committing are independent explicit operations, including nested cwd", async (t) => {
  const app = await setup(t);
  stageFixture(app.cwd);
  const nested = join(app.cwd, "nested");
  mkdirSync(nested);
  const staged = await app.run(["--output=json", "--stage"], "", {}, nested);
  assert.equal(staged.code, 0, staged.stderr);
  const first = json(staged);
  assert.ok(first.ok);
  assert.equal(first.staged, true);
  assert.equal(first.committed, false);
  assert.equal(git(app.cwd, "show", ":changed.txt"), "unstaged content");
  assert.match(
    git(app.cwd, "diff", "--cached", "--name-only"),
    /untracked.txt/,
  );
  assert.equal(git(app.cwd, "rev-parse", "--revs-only", "HEAD"), "");
  writeFileSync(join(app.cwd, "later.txt"), "stay untracked");
  const committed = await app.run(["--output=json", "--commit"]);
  assert.equal(committed.code, 0, committed.stderr);
  const second = json(committed);
  assert.ok(second.ok);
  assert.equal(second.staged, false);
  assert.equal(second.committed, true);
  assert.equal(git(app.cwd, "log", "-1", "--format=%B"), message);
  assert.doesNotMatch(
    git(app.cwd, "ls-tree", "--name-only", "HEAD"),
    /later.txt/,
  );
});

test("commit failure preserves diagnostics from both Git streams and the generated message", async (t) => {
  const app = await setup(t);
  stageFixture(app.cwd);
  const hook = join(app.cwd, ".git/hooks/pre-commit");
  writeFileSync(
    hook,
    "#!/bin/sh\nprintf 'hook stdout detail\\n'\nprintf 'hook stderr detail\\n' >&2\nexit 1\n",
  );
  chmodSync(hook, 0o755);
  const result = await app.run(["--output=json", "--commit"]);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "GIT");
  assert.equal(value.message, message);
  for (const stream of ["stdout", "stderr"]) {
    assert.match(value.error.message, new RegExp(`hook ${stream} detail`));
    assert.match(result.stderr, new RegExp(`hook ${stream} detail`));
  }
  assert.equal(git(app.cwd, "rev-parse", "--revs-only", "HEAD"), "");
});

test("Git signing failures retain the underlying diagnostic", async (t) => {
  const app = await setup(t);
  stageFixture(app.cwd);
  const signer = join(app.cwd, "fail-signing");
  writeFileSync(
    signer,
    "#!/bin/sh\nprintf 'signing agent unavailable\\n' >&2\nexit 1\n",
  );
  chmodSync(signer, 0o755);
  const result = await app.run(["--commit", "--output=json"], "", {
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "true",
    GIT_CONFIG_KEY_1: "gpg.program",
    GIT_CONFIG_VALUE_1: signer,
    GIT_CONFIG_KEY_2: "user.signingkey",
    GIT_CONFIG_VALUE_2: "test-key",
  });
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "GIT");
  assert.match(value.error.message, /signing agent unavailable/);
});

test("explicit staging failures preserve Git diagnostics", async (t) => {
  const app = await setup(t);
  stageFixture(app.cwd);
  writeFileSync(join(app.cwd, ".git/index.lock"), "locked");
  const result = await app.run(["--stage", "--output=json"]);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "GIT");
  assert.match(value.error.message, /index.lock/);
  assert.equal(app.requests.length, 0);
});

test("index changes during generation prevent committing the wrong snapshot", async (t) => {
  const app = await setup(t, {
    onRequest: () => {
      writeFileSync(join(root, "during.txt"), "new staged content");
      git(root, "add", "during.txt");
    },
  });
  const root = app.cwd;
  stageFixture(root);
  const result = await app.run(["--output=json", "--commit"]);
  assert.equal(result.code, 1);
  const value = json(result);
  assert.ok(!value.ok);
  assert.equal(value.error.code, "GIT");
  assert.match(value.error.message, /Staged content changed/);
  assert.equal(git(root, "rev-parse", "--revs-only", "HEAD"), "");
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`${signal} while awaiting stdin emits one cancellation result and exits ${code}`, async (t) => {
    const app = await setup(t, { outside: true });
    const run = app.start(["--stdin", "--output=json", "--debug"], null);
    run.child.stderr.on("data", (chunk: string) => {
      if (chunk.includes("reading diff from stdin")) run.child.kill(signal);
    });
    const result = await run.done;
    assert.equal(result.code, code, result.stderr);
    const value = json(result);
    assert.ok(!value.ok);
    assert.equal(value.error.code, "CANCELED");
    assert.equal(app.requests.length, 0);
  });
  test(`${signal} during a provider request cancels generation with status ${code}`, async (t) => {
    const app = await setup(t, {
      hold: true,
      onRequest: () => {
        run.child.kill(signal);
      },
    });
    stageFixture(app.cwd);
    const index = readFileSync(join(app.cwd, ".git/index"));
    const run = app.start(["--output=json"]);
    const result = await run.done;
    assert.equal(result.code, code, result.stderr);
    const value = json(result);
    assert.ok(!value.ok);
    assert.equal(value.error.code, "CANCELED");
    assert.deepEqual(readFileSync(join(app.cwd, ".git/index")), index);
  });
}

test("legacy --yes stages only when needed and --dry-run remains a human preview", async (t) => {
  const app = await setup(t);
  writeFileSync(join(app.cwd, "first.txt"), "change");
  const preview = await app.run(["--yes", "--dry-run"]);
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /Staged files:/);
  assert.equal(git(app.cwd, "diff", "--cached", "--name-only"), "");
  const commit = await app.run(["--yes"]);
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(git(app.cwd, "log", "-1", "--format=%B"), message);
});
