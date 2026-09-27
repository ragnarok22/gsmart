import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { createMainCommand } from "../src/commands/main.ts";
import type { AIBuilder } from "../src/utils/ai.ts";
import type { EditResult } from "../src/utils/editor.ts";
import type { StagedSnapshot } from "../src/utils/git.ts";
import { dispatchInterrupt } from "../src/utils/interrupt.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import type { EffectiveConventions } from "../src/definitions.ts";

const original =
  "feat(db): add migration\n\nCreate the accounts table.\nKeep existing records.";
const revised = "feat(db): add accounts table";
const initialSnapshot = {
  branch: "feature/accounts",
  diff: "+ original changes",
  fingerprint: "original-index",
};
const updatedSnapshot = {
  ...initialSnapshot,
  diff: "+ updated changes",
  fingerprint: "updated-index",
};

function setup({
  responses = [],
  results = [original],
  edits = [],
  snapshots = [initialSnapshot],
  onGenerate,
  effective,
  interactive = true,
}: {
  responses?: Record<string, unknown>[];
  results?: (string | { error: string } | Error)[];
  edits?: EditResult[];
  snapshots?: (StagedSnapshot | Error)[];
  effective?: EffectiveConventions;
  interactive?: boolean;
  onGenerate?: (
    requestNumber: number,
    options?: Parameters<AIBuilder["generateCommitMessage"]>[2],
  ) => void;
} = {}) {
  const output: string[] = [];
  const committed: string[] = [];
  const copied: string[] = [];
  const editorInputs: string[] = [];
  const questions: string[] = [];
  const commitEnabled: boolean[] = [];
  const constructors: string[][] = [];
  const requests: {
    branch: string;
    diff: string;
    options?: Parameters<AIBuilder["generateCommitMessage"]>[2];
  }[] = [];
  let retrievals = 0;
  let snapshotReads = 0;
  let exitCode = 0;
  const spinner = {
    isSpinning: false,
    text: "",
    start() {
      this.isSpinning = true;
      return this;
    },
    stop() {
      this.isSpinning = false;
      return this;
    },
    succeed(message = "") {
      output.push(message);
      return this.stop();
    },
    fail(message = "") {
      output.push(message);
      return this.stop();
    },
    warn(message = "") {
      output.push(message);
      return this.stop();
    },
    info(message = "") {
      output.push(message);
      return this.stop();
    },
  };
  const command = createMainCommand({
    loadEffectiveConventions: async ({ user = {}, cli = {} } = {}) =>
      effective ??
      resolveConventions([
        { source: "user", settings: user },
        { source: "CLI", settings: cli },
      ]),
    spinner: (() => spinner) as never,
    isInteractive: () => interactive,
    prompt: async (question) => {
      assert.ok(!Array.isArray(question));
      questions.push(String(question.name));
      if (question.name === "action") {
        assert.ok(Array.isArray(question.choices));
        const commit = question.choices.find(({ value }) => value === "commit");
        assert.ok(commit);
        commitEnabled.push(!commit.disabled);
      }
      assert.ok(responses.length, `Unexpected prompt: ${question.name}`);
      return responses.shift()!;
    },
    config: {
      getDefaultProvider: () => undefined,
      getModel: () => "",
      getKey: () => "key",
      getAllKeys: () => ({ anthropic: "key" }),
      getPrompt: () => "Mention migrations",
    } as never,
    getActiveProviders: () => [
      { title: "Anthropic", value: "anthropic", description: "", active: true },
    ],
    AIBuilder: class {
      constructor(provider: string, prompt: string) {
        constructors.push([provider, prompt]);
      }
      async generateCommitMessage(
        branch: string,
        diff: string,
        options?: Parameters<AIBuilder["generateCommitMessage"]>[2],
      ) {
        requests.push({ branch, diff, options });
        onGenerate?.(requests.length, options);
        assert.ok(results.length, "Unexpected AI request");
        const result = results.shift()!;
        if (result instanceof Error) throw result;
        return result;
      }
    },
    retrieveFilesToCommit: async () => {
      retrievals++;
      return initialSnapshot.diff;
    },
    getGitBranch: async () => initialSnapshot.branch,
    getStagedSnapshot: async () => {
      snapshotReads++;
      const snapshot = snapshots.length > 1 ? snapshots.shift()! : snapshots[0];
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    },
    editMessage: async (message) => {
      editorInputs.push(message);
      assert.ok(edits.length, "Unexpected editor launch");
      return edits.shift()!;
    },
    commitChanges: async (message) => {
      committed.push(message);
      return true;
    },
    copyToClipboard: async (message) => {
      copied.push(message);
      return true;
    },
    log: (...args) => output.push(args.join(" ")),
    debugLog: () => {},
    debugTime: () => () => {},
    setExitCode: (code) => {
      exitCode = code;
    },
  });
  return {
    command,
    committed,
    copied,
    editorInputs,
    requests,
    constructors,
    questions,
    commitEnabled,
    output: () => stripVTControlCharacters(output.join("\n")),
    retrievals: () => retrievals,
    snapshotReads: () => snapshotReads,
    exitCode: () => exitCode,
  };
}

for (const yes of [false, true]) {
  test(`PR 508: legitimate prose about commit messages can be committed (yes=${yes})`, async () => {
    const message =
      "docs: clarify validation\n\nThe commit message uses the configured format.";
    const run = setup({
      results: [message],
      responses: yes ? [] : [{ action: "commit" }, { action: "nothing" }],
    });
    await run.command.action({ yes });
    assert.deepEqual(run.committed, [message]);
    assert.equal(run.exitCode(), 0);
    assert.doesNotMatch(run.output(), /Invalid commit message/);
    assert.deepEqual(run.commitEnabled, yes ? [] : [true]);
    assert.deepEqual(run.questions, yes ? [] : ["action"]);
    assert.equal(run.snapshotReads(), 2);
  });
}

test("PR 508: a documentation edit can be restored and committed after a wrapped refinement", async () => {
  const edited =
    "docs: clarify validation\n\nThe commit message uses the configured format.\n\nNotes: Describe the accepted format.\nLet me know if you want a different commit message.";
  const wrapped = "Here is your commit message:\n\n" + revised;
  const run = setup({
    results: [original, wrapped],
    edits: [{ status: "edited", message: edited }],
    responses: [
      { action: "edit" },
      { action: "regenerate" },
      { feedback: "Make the documentation more concise" },
      { action: "commit" },
      { action: "history" },
      { candidate: 1 },
      { restore: true },
      { action: "commit" },
    ],
  });
  await run.command.action({});
  assert.deepEqual(run.editorInputs, [original]);
  assert.deepEqual(run.requests[1].options?.refinement, {
    previousMessage: edited,
    feedback: "Make the documentation more concise",
  });
  assert.deepEqual(run.commitEnabled, [true, true, false, false, true]);
  assert.deepEqual(run.committed, [edited]);
  assert.equal(run.requests.length, 2);
  assert.equal(run.snapshotReads(), 2);
  assert.equal(run.exitCode(), 0);
  assert.match(run.output(), /error \[wrapper\]/);
});

test("review edits a complete multiline message and waits for Commit", async () => {
  const edited = "fix(db): migrate accounts\n\nPreserve old IDs.\n\nRefs: #499";
  const run = setup({
    responses: [{ action: "edit" }, { action: "commit" }],
    edits: [{ status: "edited", message: edited }],
  });
  await run.command.action({});
  assert.deepEqual(run.editorInputs, [original]);
  assert.deepEqual(run.committed, [edited]);
  assert.equal(run.requests.length, 1);
  assert.ok(run.output().includes(edited));
});

test("review blocks malformed generated messages until they are edited", async () => {
  const run = setup({
    results: ["Here is your commit message:\n\nfeat: add accounts"],
    responses: [{ action: "commit" }, { action: "edit" }, { action: "commit" }],
    edits: [{ status: "edited", message: revised }],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, [revised]);
  assert.match(run.output(), /invalid|validation/i);
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.commitEnabled, [false, false, true]);
});

test("review blocks invalid manual edits and can regenerate a valid candidate", async () => {
  const run = setup({
    results: [original, revised],
    responses: [
      { action: "edit" },
      { action: "commit" },
      { action: "regenerate" },
      { feedback: "Use a Conventional Commit header" },
      { action: "commit" },
    ],
    edits: [{ status: "edited", message: "not a conventional commit" }],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, [revised]);
  assert.equal(run.requests.length, 2);
  assert.deepEqual(run.requests[1].options?.refinement, {
    previousMessage: "not a conventional commit",
    feedback: "Use a Conventional Commit header",
  });
});

test("an empty initial candidate can be edited without losing the draft", async () => {
  const run = setup({
    results: ["\r\n\r\n"],
    responses: [{ action: "edit" }, { action: "commit" }],
    edits: [{ status: "edited", message: revised + "\r\n" }],
  });
  await run.command.action({});
  assert.deepEqual(run.editorInputs, [""]);
  assert.deepEqual(run.commitEnabled, [false, true]);
  assert.deepEqual(run.committed, [revised]);
  assert.equal(run.exitCode(), 0);
  assert.match(run.output(), /empty/i);
});

test("restoring an invalid candidate cannot bypass validation or lose a valid candidate", async () => {
  const invalid = "Here is the message:\n\n" + revised;
  const run = setup({
    results: [invalid, revised],
    responses: [
      { action: "regenerate" },
      { feedback: "Only the commit message" },
      { action: "history" },
      { candidate: 0 },
      { restore: true },
      { action: "commit" },
      { action: "history" },
      { candidate: 1 },
      { restore: true },
      { action: "commit" },
    ],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, [revised]);
  assert.deepEqual(run.commitEnabled, [false, true, false, false, true]);
  assert.equal(run.requests[1].options?.refinement?.previousMessage, invalid);
  assert.equal(
    run.snapshotReads(),
    2,
    "invalid Commit must not read the index",
  );
  assert.ok(run.output().includes(invalid));
});

test("empty refinement remains an invalid draft and the prior valid candidate can be restored", async () => {
  const run = setup({
    results: [original, "   "],
    responses: [
      { action: "regenerate" },
      { feedback: "shorter" },
      { action: "commit" },
      { action: "edit" },
      { action: "history" },
      { candidate: 0 },
      { restore: true },
      { action: "commit" },
    ],
    edits: [{ status: "cancelled" }],
  });
  await run.command.action({});
  assert.deepEqual(run.editorInputs, ["   "]);
  assert.deepEqual(run.committed, [original]);
  assert.equal(run.exitCode(), 0);
});

test("an empty manual edit stays editable and cannot be committed", async () => {
  const run = setup({
    responses: [
      { action: "edit" },
      { action: "commit" },
      { action: "edit" },
      { action: "commit" },
    ],
    edits: [
      { status: "edited", message: "" },
      { status: "edited", message: revised },
    ],
  });
  await run.command.action({});
  assert.deepEqual(run.editorInputs, [original, ""]);
  assert.deepEqual(run.committed, [revised]);
});

test("leading whitespace in an edit is preserved for recovery instead of silently repaired", async () => {
  const invalid = "  " + revised;
  const run = setup({
    responses: [
      { action: "edit" },
      { action: "commit" },
      { action: "edit" },
      { action: "commit" },
    ],
    edits: [
      { status: "edited", message: invalid + "\r\n" },
      { status: "edited", message: revised },
    ],
  });
  await run.command.action({});
  assert.deepEqual(run.editorInputs, [original, invalid]);
  assert.deepEqual(run.committed, [revised]);
});

for (const yes of [false, true]) {
  test(`validation warnings remain visible and allow Commit (yes=${yes})`, async () => {
    const run = setup({
      effective: resolveConventions([
        {
          source: ".commitlintrc.json",
          settings: { headerMaxLength: 10 },
          ruleMetadata: {
            headerMaxLength: { name: "header-max-length", severity: 1 },
          },
        },
      ]),
      responses: yes ? [] : [{ action: "commit" }],
    });
    await run.command.action({ yes });
    assert.deepEqual(run.committed, [original]);
    assert.equal(run.exitCode(), 0);
    assert.match(run.output(), /header-max-length/);
    assert.match(run.output(), /\.commitlintrc\.json/);
    assert.deepEqual(run.commitEnabled, yes ? [] : [true]);
  });
}

test("repository rule errors block Commit until a compliant edit", async () => {
  const run = setup({
    effective: resolveConventions([
      { source: ".gsmartrc.json", settings: { types: ["fix"] } },
    ]),
    responses: [{ action: "commit" }, { action: "edit" }, { action: "commit" }],
    edits: [{ status: "edited", message: "fix(db): migrate accounts" }],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, ["fix(db): migrate accounts"]);
  assert.deepEqual(run.commitEnabled, [false, false, true]);
  assert.match(run.output(), /\.gsmartrc\.json/);
});

for (const candidate of ["", "not a conventional commit"]) {
  test(`no TTY rejects ${JSON.stringify(candidate)} without a recovery prompt`, async () => {
    const run = setup({ results: [candidate], interactive: false });
    await run.command.action({});
    assert.deepEqual(run.questions, []);
    assert.deepEqual(run.committed, []);
    assert.equal(run.exitCode(), 1);
    assert.match(run.output(), /invalid|validation/i);
  });
}

test("dry-run labels invalid previews and fails without reviewing or inspecting the index", async () => {
  const candidate = "```\nfeat: invalid wrapper\n```";
  const run = setup({ results: [candidate] });
  await run.command.action({ dryRun: true });
  assert.deepEqual(run.questions, []);
  assert.deepEqual(run.committed, []);
  assert.equal(run.snapshotReads(), 0);
  assert.equal(run.exitCode(), 1);
  assert.match(run.output(), /invalid commit message preview/i);
  assert.ok(run.output().includes(candidate));
});

test("generated newline normalization is consistent for review and committing", async () => {
  const run = setup({
    results: [original.replaceAll("\n", "\r") + "\r\n\r\n"],
    responses: [{ action: "commit" }],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, [original]);
});

test("--yes rejects a fenced message without committing or prompting", async () => {
  const run = setup({ results: ["```\nfeat: add accounts\n```"] });
  await run.command.action({ yes: true });
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.questions, []);
  assert.equal(run.exitCode(), 1);
  assert.match(run.output(), /invalid|validation/i);
});

test("review refines the edited candidate using one provider and captured diff", async () => {
  const run = setup({
    responses: [
      { action: "edit" },
      { action: "regenerate" },
      { feedback: "shorter" },
      { action: "commit" },
    ],
    edits: [
      { status: "edited", message: "fix(db): migration\n\nFix account IDs." },
    ],
    results: [original, revised],
  });
  await run.command.action({});
  assert.deepEqual(run.constructors, [["anthropic", "Mention migrations"]]);
  assert.equal(run.retrievals(), 1);
  assert.equal(run.snapshotReads(), 2);
  assert.deepEqual(
    run.requests.map(({ branch, diff }) => ({ branch, diff })),
    [
      { branch: initialSnapshot.branch, diff: initialSnapshot.diff },
      { branch: initialSnapshot.branch, diff: initialSnapshot.diff },
    ],
  );
  assert.deepEqual(run.requests[1].options?.refinement, {
    previousMessage: "fix(db): migration\n\nFix account IDs.",
    feedback: "shorter",
  });
  assert.deepEqual(run.committed, [revised]);
});

test("review restores an earlier multiline candidate without generating again", async () => {
  const run = setup({
    responses: [
      { action: "regenerate" },
      { feedback: "" },
      { action: "history" },
      { candidate: 0 },
      { restore: true },
      { action: "commit" },
    ],
    results: [original, revised],
  });
  await run.command.action({});
  assert.equal(run.requests.length, 2);
  assert.deepEqual(run.committed, [original]);
  assert.ok(run.output().includes(original));
  assert.ok(run.output().includes(revised));
});

for (const result of [
  { status: "cancelled" },
  { status: "error", error: "Set EDITOR to an installed editor" },
] as const) {
  test(`review preserves candidate after editor ${result.status}`, async () => {
    const run = setup({
      responses: [{ action: "edit" }, { action: "copy" }],
      edits: [result],
    });
    await run.command.action({});
    assert.deepEqual(run.committed, []);
    assert.deepEqual(run.copied, [original]);
    assert.equal(run.requests.length, 1);
    if (result.status === "error")
      assert.ok(run.output().includes(result.error));
  });
}

test("review cancellation of feedback or history preserves the current candidate", async () => {
  const run = setup({
    responses: [
      { action: "regenerate" },
      {},
      { action: "history" },
      {},
      { action: "history" },
      { candidate: 0 },
      {},
      { action: "copy" },
    ],
  });
  await run.command.action({});
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.copied, [original]);
});

for (const failure of [
  { error: "Rate limited" },
  new Error("Model unavailable"),
]) {
  test(`review retains candidate after unsuccessful refinement: ${String(failure)}`, async () => {
    const run = setup({
      responses: [
        { action: "regenerate" },
        { feedback: "shorter" },
        { action: "commit" },
      ],
      results: [original, failure],
    });
    await run.command.action({});
    assert.deepEqual(run.committed, [original]);
    assert.equal(run.exitCode(), 0);
  });
}

test("interrupting an in-flight refinement preserves the current candidate", async () => {
  const run = setup({
    responses: [
      { action: "regenerate" },
      { feedback: "shorter" },
      { action: "copy" },
    ],
    results: [original, "discard this late result"],
    onGenerate: (number, options) => {
      if (number === 2) {
        assert.equal(dispatchInterrupt("SIGINT"), true);
        assert.equal(options?.abortSignal?.aborted, true);
      }
    },
  });
  await run.command.action({});
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.copied, [original]);
  assert.match(run.output(), /cancel.*candidate kept/i);
  assert.equal(run.exitCode(), 0);
  assert.equal(dispatchInterrupt("SIGINT"), false);
});

test("review refreshes changed staged content and requires another Commit selection", async () => {
  const run = setup({
    responses: [{ action: "commit" }, { refresh: true }, { action: "commit" }],
    results: [original, revised],
    snapshots: [initialSnapshot, updatedSnapshot],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, [revised]);
  assert.deepEqual(run.questions, ["action", "refresh", "action"]);
  assert.equal(run.requests[1].diff, updatedSnapshot.diff);
  assert.equal(run.requests[1].options?.refinement, undefined);
  assert.equal(run.retrievals(), 1);
  assert.equal(run.constructors.length, 1);
  assert.match(run.output(), /staged (content|changes).*changed/i);
});

test("review preserves original when refreshed generation fails", async () => {
  const run = setup({
    responses: [{ action: "commit" }, { refresh: true }, { action: "copy" }],
    results: [original, { error: "Offline" }],
    snapshots: [initialSnapshot, updatedSnapshot],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.copied, [original]);
  assert.equal(run.exitCode(), 0);
});

test("restoring and editing an outdated candidate cannot bypass refreshed review", async () => {
  const run = setup({
    responses: [
      { action: "commit" },
      { refresh: true },
      { action: "history" },
      { candidate: 0 },
      { restore: true },
      { action: "edit" },
      { action: "commit" },
      {},
      { action: "copy" },
    ],
    results: [original, revised],
    edits: [{ status: "edited", message: "fix: old candidate edited" }],
    snapshots: [initialSnapshot, updatedSnapshot],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, []);
  assert.equal(run.requests.length, 2);
  assert.deepEqual(run.copied, ["fix: old candidate edited"]);
  assert.match(run.output(), /outdated/i);
});

test("review checks again when staging changes during refreshed generation", async () => {
  const run = setup({
    responses: [
      { action: "commit" },
      { refresh: true },
      { action: "commit" },
      { refresh: false },
      { action: "nothing" },
    ],
    results: [original, revised],
    snapshots: [
      initialSnapshot,
      updatedSnapshot,
      updatedSnapshot,
      { ...updatedSnapshot, fingerprint: "third-index" },
    ],
  });
  await run.command.action({});
  assert.deepEqual(run.committed, []);
  assert.equal(run.questions.filter((name) => name === "refresh").length, 2);
});

for (const snapshot of [
  { ...updatedSnapshot, diff: "" },
  new Error("Cannot read index"),
]) {
  test(`review does not commit with unavailable staged changes: ${String(snapshot)}`, async () => {
    const run = setup({
      responses: [{ action: "commit" }, { action: "copy" }],
      snapshots: [initialSnapshot, snapshot],
    });
    await run.command.action({});
    assert.deepEqual(run.committed, []);
    assert.deepEqual(run.copied, [original]);
  });
}

test("--yes stops without prompts if staged content changes", async () => {
  const run = setup({ snapshots: [initialSnapshot, updatedSnapshot] });
  await run.command.action({ yes: true });
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.questions, []);
  assert.equal(run.exitCode(), 1);
});

test("an unreadable initial snapshot stops before generating or prompting", async () => {
  const run = setup({ snapshots: [new Error("Cannot read index")] });
  await run.command.action({});
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.requests, []);
  assert.deepEqual(run.questions, []);
  assert.equal(run.exitCode(), 1);
});

test("--yes commits a matching snapshot without review prompts", async () => {
  const run = setup();
  await run.command.action({ yes: true });
  assert.deepEqual(run.committed, [original]);
  assert.deepEqual(run.questions, []);
});

test("--yes --dry-run uses captured diff without inspecting the restored index", async () => {
  const run = setup({
    snapshots: [new Error("Dry run already unstaged its files")],
  });
  await run.command.action({ yes: true, dryRun: true });
  assert.deepEqual(run.committed, []);
  assert.deepEqual(run.questions, []);
  assert.equal(run.snapshotReads(), 0);
  assert.equal(run.requests.length, 1);
});
