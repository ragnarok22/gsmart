import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createMessageEditor, runEditor } from "../src/utils/editor.ts";
import { dispatchInterrupt } from "../src/utils/interrupt.ts";

const original =
  "feat: initial subject\n\nFirst body paragraph.\n\nSecond paragraph.";

test("editor uses VISUAL first, preserves multiline text, and removes its temporary file", async () => {
  let temporaryFile = "";
  const edited =
    "fix: revised subject\n\nPreserve this paragraph.\n\nRefs: #499";
  const edit = createMessageEditor({
    env: () => ({ VISUAL: "code --wait", EDITOR: "vi" }),
    runEditor: async (command, file) => {
      temporaryFile = file;
      assert.equal(command, "code --wait");
      assert.equal(readFileSync(file, "utf8"), `${original}\n`);
      writeFileSync(file, `${edited.replaceAll("\n", "\r\n")}\r\n`);
      return { code: 0, signal: null };
    },
  });
  assert.deepEqual(await edit(original), { status: "edited", message: edited });
  assert.ok(!existsSync(dirname(temporaryFile)));
});

for (const [env, platform, expected] of [
  [{ EDITOR: "emacs -nw" }, "linux", "emacs -nw"],
  [{ VISUAL: "  ", EDITOR: "nano" }, "darwin", "nano"],
  [{}, "linux", "vi"],
  [{}, "darwin", "vi"],
  [{}, "win32", "notepad"],
] as const) {
  test(`editor selection on ${platform}: ${JSON.stringify(env)}`, async () => {
    const edit = createMessageEditor({
      env: () => env,
      platform: () => platform,
      runEditor: async (command) => {
        assert.equal(command, expected);
        return { code: 0, signal: null };
      },
    });
    assert.deepEqual(await edit(original), { status: "cancelled" });
  });
}

test("editor treats a signaled process as cancellation and cleans up", async () => {
  let filePath = "";
  const edit = createMessageEditor({
    runEditor: async (_command, file) => {
      filePath = file;
      writeFileSync(file, "partially edited message");
      return { code: null, signal: "SIGINT" };
    },
  });
  assert.deepEqual(await edit(original), { status: "cancelled" });
  assert.ok(!existsSync(dirname(filePath)));
});

for (const mode of ["exit", "spawn", "empty", "missing-file"] as const) {
  test(`editor ${mode} failure is actionable and cleans up`, async () => {
    let filePath = "";
    const edit = createMessageEditor({
      env: () => ({ EDITOR: "my-editor --wait" }),
      runEditor: async (_command, file) => {
        filePath = file;
        if (mode === "spawn") throw new Error("ENOENT");
        if (mode === "empty") writeFileSync(file, " \n\t ");
        if (mode === "missing-file") rmSync(file);
        return { code: mode === "exit" ? 1 : 0, signal: null };
      },
    });
    const result = await edit(original);
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.match(result.error, /empty|VISUAL|EDITOR/i);
      assert.match(result.error, /kept|unchanged/i);
    }
    assert.ok(!existsSync(dirname(filePath)));
  });
}

test("editor runner supports arguments and paths containing spaces without interpreting message content", async () => {
  const root = mkdtempSync(join(tmpdir(), "gsmart editor test "));
  try {
    const script = join(root, "fake editor.cjs");
    const message = join(root, "message with spaces.txt");
    writeFileSync(message, "$(touch should-not-exist)\n\nOriginal body");
    writeFileSync(
      script,
      `const fs = require('node:fs');
      const [flag, file] = process.argv.slice(2);
      if (flag !== '--wait') process.exit(1);
      fs.appendFileSync(file, '\\nEdited body');`,
    );
    const result = await runEditor(
      `"${process.execPath}" "${script}" --wait`,
      message,
      process.platform,
    );
    assert.equal(result.code, 0);
    assert.equal(
      readFileSync(message, "utf8"),
      "$(touch should-not-exist)\n\nOriginal body\nEdited body",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interrupting an active editor preserves the candidate and cleans up before returning", async () => {
  const root = mkdtempSync(join(tmpdir(), "gsmart-editor-interrupt-"));
  const script = join(root, "editor.cjs");
  const ready = join(root, "ready");
  writeFileSync(
    script,
    `const fs = require('node:fs');
    process.on('SIGINT', () => process.exit(0));
    fs.writeFileSync(process.argv[2], 'ready');
    setInterval(() => {}, 1000);`,
  );
  let messageFile = "";
  const edit = createMessageEditor({
    env: () => ({ EDITOR: `"${process.execPath}" "${script}" "${ready}"` }),
    runEditor: async (command, file, platform) => {
      messageFile = file;
      return runEditor(command, file, platform);
    },
  });
  const result = edit(original);
  try {
    for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt++)
      await delay(20);
    assert.ok(existsSync(ready), "Editor did not start");
    assert.equal(dispatchInterrupt("SIGINT"), true);
    assert.deepEqual(await result, { status: "cancelled" });
    assert.ok(!existsSync(dirname(messageFile)));
    assert.equal(dispatchInterrupt("SIGINT"), false);
  } finally {
    dispatchInterrupt("SIGTERM");
    await result;
    rmSync(root, { recursive: true, force: true });
  }
});
