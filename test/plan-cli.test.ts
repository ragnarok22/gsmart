import "../test-support/setup-env";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  git,
  repository,
  temporaryDirectory,
} from "../test-support/repository.ts";
import { commit } from "../test-support/split-plan-fixtures.ts";

const entry =
  process.env.GSMART_TEST_CLI_ENTRY ??
  fileURLToPath(new URL("../src/index.ts", import.meta.url));

async function setup(
  t: TestContext,
  {
    text = JSON.stringify({ commits: [commit("one", ["f1"])] }),
    status = 200,
    hold = false,
    onRequest,
    configured = true,
  }: {
    text?: string;
    status?: number;
    hold?: boolean;
    onRequest?: () => void;
    configured?: boolean;
  } = {},
) {
  const cwd = repository(t);
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
          : { error: { message: "rejected by test provider" } },
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
  writeFileSync(
    join(store, "config.json"),
    JSON.stringify(
      configured
        ? {
            defaultProvider: "custom",
            custom: {
              baseURL: `http://127.0.0.1:${address.port}/v1`,
              model: "local",
            },
          }
        : {},
    ),
  );
  function start(args: string[], directory = cwd) {
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
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GSMART_CONFIG_DIR: store,
          XDG_CONFIG_HOME: store,
          FORCE_COLOR: "0",
          NO_UPDATE_NOTIFIER: "1",
          SHELL: "/bin/bash",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
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
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    t.after(() => {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const done = once(child, "close").then(([code, signal]) => {
      clearTimeout(timer);
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
    run: (args: string[], directory?: string) => start(args, directory).done,
  };
}

function stage(cwd: string) {
  writeFileSync(join(cwd, "change.txt"), "staged content\n");
  git(cwd, "add", "change.txt");
  writeFileSync(join(cwd, "change.txt"), "private unstaged content\n");
  writeFileSync(join(cwd, "untracked.txt"), "private untracked content\n");
}

/** Read every worktree file, including untracked files, without index refreshes. */
function state(cwd: string) {
  const files: Record<string, { mode: number; content: Buffer | string }> = {};
  const walk = (relative = "") => {
    for (const name of readdirSync(join(cwd, relative))) {
      if (!relative && name === ".git") continue;
      const path = join(relative, name);
      const stat = lstatSync(join(cwd, path));
      if (stat.isDirectory()) walk(path);
      else
        files[path] = {
          mode: stat.mode,
          content: stat.isSymbolicLink()
            ? readlinkSync(join(cwd, path))
            : readFileSync(join(cwd, path)),
        };
    }
  };
  walk();
  return {
    head: git(cwd, "rev-parse", "--revs-only", "HEAD"),
    index: existsSync(join(cwd, ".git/index"))
      ? readFileSync(join(cwd, ".git/index"))
      : null,
    files,
  };
}

test("plan --staged is read-only for an unborn HEAD with partially staged and untracked files", async (t) => {
  const app = await setup(t);
  stage(app.cwd);
  const before = state(app.cwd);
  const result = await app.run(["plan", "--staged"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Staged commit plan \(advisory\)/);
  assert.match(result.stdout, /1 proposed commit/);
  assert.match(result.stdout, /"change.txt" — added/);
  assert.equal(result.stderr, "");
  assert.deepEqual(state(app.cwd), before);
  assert.equal(app.requests.length, 1);
  assert.doesNotMatch(
    JSON.stringify(app.requests),
    /private unstaged|private untracked/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(app.store, "config.json"), "utf8"))
      .welcomeShown,
    undefined,
  );
});

test("mixed real Git changes include hunks, rename sources, deletions and binaries from a nested cwd", async (t) => {
  const app = await setup(t, {
    text: JSON.stringify({
      commits: [
        commit("assets", ["f1", "f2", "f4"], {
          message: "chore: reorganize assets",
          rationale:
            "Rename one asset, delete obsolete content and replace the binary.",
        }),
        commit("feature", ["f3.h1"], { message: "feat: increase retries" }),
        commit("format", ["f3.h2"], {
          message: "style: format feature label",
          cautions: ["Split the shared file manually."],
        }),
      ],
    }),
  });
  const original =
    Array.from({ length: 60 }, (_, i) => `export const value${i} = ${i};`).join(
      "\n",
    ) + "\n";
  writeFileSync(join(app.cwd, "feature.ts"), original);
  writeFileSync(join(app.cwd, "old.txt"), "unique renamed content\n");
  writeFileSync(join(app.cwd, "deleted.txt"), "obsolete deleted content\n");
  writeFileSync(join(app.cwd, "binary.dat"), Buffer.from([0, 1, 2]));
  git(app.cwd, "add", ".");
  git(app.cwd, "commit", "-qm", "feat: baseline");
  git(app.cwd, "mv", "old.txt", "new.txt");
  rmSync(join(app.cwd, "deleted.txt"));
  writeFileSync(join(app.cwd, "binary.dat"), Buffer.from([0, 3, 4]));
  writeFileSync(
    join(app.cwd, "feature.ts"),
    original
      .replace("value0 = 0", "value0 = 3")
      .replace("value59 = 59", "value59=59"),
  );
  git(app.cwd, "add", "-A");
  writeFileSync(join(app.cwd, "feature.ts"), "private unstaged replacement\n");
  writeFileSync(join(app.cwd, "untracked.txt"), "leave untouched\n");
  mkdirSync(join(app.cwd, "nested"));
  const before = state(app.cwd);
  const result = await app.run(
    ["plan", "--staged", "--context-budget", "16384"],
    join(app.cwd, "nested"),
  );
  assert.equal(result.code, 0, result.stderr);
  for (const text of [
    "binary.dat",
    "deleted.txt",
    "feature.ts",
    "new.txt",
    '(from "old.txt")',
    "Manual splitting",
    "5 change unit(s) assigned exactly once",
  ])
    assert.ok(result.stdout.includes(text), result.stdout);
  assert.deepEqual(state(app.cwd), before);
});

test("planner honors provider/model, conventions, history, and CLI overrides on either side of the command", async (t) => {
  const app = await setup(t);
  writeFileSync(join(app.cwd, "base.txt"), "baseline");
  git(app.cwd, "add", ".");
  git(app.cwd, "commit", "-qm", "feat(api): preserve style");
  stage(app.cwd);
  writeFileSync(
    join(app.cwd, ".gsmartrc.json"),
    JSON.stringify({ language: "es", history: { enabled: true, limit: 1 } }),
  );
  const before = state(app.cwd);
  const result = await app.run([
    "--prompt",
    "First instruction",
    "--provider",
    "custom",
    "plan",
    "--staged",
    "--prompt",
    "Final instruction",
    "--model",
    "override",
    "--show-context",
    "--debug",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(app.requests[0].model, "override");
  const request = JSON.stringify(app.requests[0]);
  assert.match(request, /Final instruction/);
  assert.doesNotMatch(request, /First instruction/);
  assert.match(request, /language es/);
  assert.match(request, /preserve style/);
  assert.match(result.stderr, /"context":/);
  assert.match(result.stderr, /\[debug cli\]/);
  assert.doesNotMatch(result.stdout, /\[debug|Quick start|Update available/);
  assert.deepEqual(state(app.cwd), before);
});

test("excluded scope lists manual-review items without making an AI request", async (t) => {
  const app = await setup(t);
  stage(app.cwd);
  const before = state(app.cwd);
  const result = await app.run(["plan", "--staged", "--context-exclude", "**"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /0 proposed commit/);
  assert.match(result.stdout, /1 excluded unit/);
  assert.match(result.stdout, /change.txt/);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(state(app.cwd), before);
});

for (const provider of [undefined, "anthropic", "custom"]) {
  test(`all-excluded planning needs no provider configuration (${provider ?? "automatic selection"})`, async (t) => {
    const app = await setup(t, { configured: false });
    stage(app.cwd);
    const before = state(app.cwd);
    const result = await app.run([
      "plan",
      "--staged",
      "--context-exclude",
      "**",
      ...(provider ? ["--provider", provider] : []),
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /0 proposed commit/);
    assert.match(result.stdout, /Manual review.*excluded from AI context/);
    assert.match(result.stdout, /"change.txt"/);
    assert.match(
      result.stdout,
      /0 change unit\(s\) assigned exactly once; 1 excluded unit/,
    );
    assert.equal(app.requests.length, 0);
    assert.deepEqual(state(app.cwd), before);
  });
}

test("all-excluded planning honors repository exclusions despite incomplete saved provider settings", async (t) => {
  const app = await setup(t, { configured: false });
  stage(app.cwd);
  writeFileSync(
    join(app.store, "config.json"),
    JSON.stringify({ defaultProvider: "custom" }),
  );
  writeFileSync(
    join(app.cwd, ".gsmartrc.json"),
    JSON.stringify({
      context: { exclude: ["change.txt"] },
      history: { enabled: true, limit: 5 },
    }),
  );
  const before = state(app.cwd);
  const result = await app.run(["plan", "--staged"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /0 proposed commit/);
  assert.match(result.stdout, /"change.txt"/);
  assert.match(result.stdout, /1 excluded unit/);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(state(app.cwd), before);
});

test("partially excluded planning still requires a configured provider", async (t) => {
  const app = await setup(t, { configured: false });
  stage(app.cwd);
  writeFileSync(join(app.cwd, "included.txt"), "needs AI grouping\n");
  git(app.cwd, "add", "included.txt");
  const before = state(app.cwd);
  const result = await app.run([
    "plan",
    "--staged",
    "--context-exclude",
    "change.txt",
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /No configured providers/);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(state(app.cwd), before);
});

for (const args of [
  ["plan"],
  ["plan", "--staged", "--yes"],
  ["plan", "--staged", "--dry-run"],
  ["plan", "--staged", "--stage"],
  ["plan", "--staged", "--commit"],
  ["plan", "--staged", "--stdin"],
  ["plan", "--staged", "--branch", "other"],
  ["plan", "--staged", "--output", "json"],
  ["plan", "--staged", "--model", ""],
  ["plan", "--staged", "--model"],
  ["plan", "--staged", "--provider", "bogus"],
  ["plan", "--staged", "--context-budget", "0"],
])
  test(`invalid planning arguments fail before requests or Git effects: ${args.join(" ")}`, async (t) => {
    const app = await setup(t);
    stage(app.cwd);
    const before = state(app.cwd);
    const result = await app.run(args);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /error:/);
    assert.equal(app.requests.length, 0);
    assert.deepEqual(state(app.cwd), before);
  });

test("an empty index never auto-stages files or calls a provider", async (t) => {
  const app = await setup(t);
  writeFileSync(join(app.cwd, "untracked.txt"), "private change");
  const before = state(app.cwd);
  const result = await app.run(["plan", "--staged"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /No staged changes/);
  assert.equal(result.stdout, "");
  assert.equal(app.requests.length, 0);
  assert.deepEqual(state(app.cwd), before);
});

for (const options of [
  { text: "invalid response" },
  { text: '{"commits":[]}' },
  { status: 401 },
  { configured: false },
]) {
  test(`failed planning preserves the repository: ${JSON.stringify(options)}`, async (t) => {
    const app = await setup(t, options);
    stage(app.cwd);
    const before = state(app.cwd);
    const result = await app.run(["plan", "--staged"]);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error:/);
    assert.deepEqual(state(app.cwd), before);
  });
}

test("changes staged concurrently make the plan stale and are left intact", async (t) => {
  let afterExternalChange: ReturnType<typeof state>;
  const app = await setup(t, {
    onRequest: () => {
      writeFileSync(join(app.cwd, "during.txt"), "external staged change");
      git(app.cwd, "add", "during.txt");
      afterExternalChange = state(app.cwd);
    },
  });
  stage(app.cwd);
  const result = await app.run(["plan", "--staged"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /changed during planning/);
  assert.equal(result.stdout, "");
  assert.deepEqual(state(app.cwd), afterExternalChange!);
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`${signal} cancels planning and preserves HEAD, index bytes and every worktree file`, async (t) => {
    const app = await setup(t, {
      hold: true,
      onRequest: () => {
        run.child.kill(signal);
      },
    });
    stage(app.cwd);
    const before = state(app.cwd);
    const run = app.start(["plan", "--staged"]);
    const result = await run.done;
    assert.equal(result.code, code, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`Planning canceled by ${signal}`));
    assert.deepEqual(state(app.cwd), before);
  });
}

test("help lists planning and its scope and options without configuration or provider requests", async (t) => {
  const app = await setup(t, { configured: false });
  for (const args of [["--help"], ["plan", "--help"], ["help", "plan"]]) {
    const result = await app.run(args);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /plan/);
    if (args.length > 1) {
      assert.match(result.stdout, /--staged/);
      assert.match(result.stdout, /--provider/);
    }
  }
  assert.equal(app.requests.length, 0);
});

test("staged submodule changes remain atomic and visible despite Git display/ignore settings", async (t) => {
  const app = await setup(t);
  writeFileSync(join(app.cwd, "base.txt"), "base");
  git(app.cwd, "add", ".");
  git(app.cwd, "commit", "-qm", "baseline");
  const first = git(app.cwd, "rev-parse", "HEAD");
  git(
    app.cwd,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${first},submodule`,
  );
  git(app.cwd, "commit", "-qm", "add gitlink");
  const second = git(app.cwd, "rev-parse", "HEAD");
  git(app.cwd, "update-index", "--cacheinfo", `160000,${second},submodule`);
  git(app.cwd, "config", "diff.submodule", "log");
  git(app.cwd, "config", "diff.ignoreSubmodules", "all");
  const before = state(app.cwd);
  const result = await app.run(["plan", "--staged"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /"submodule".*whole file/);
  assert.match(JSON.stringify(app.requests), /Subproject commit/);
  assert.deepEqual(state(app.cwd), before);
});
