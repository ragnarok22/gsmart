import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const script = resolve(import.meta.dirname, "..", "scripts", "postinstall.js");

const run = (shell: string): string => {
  return execFileSync("node", [script], {
    env: { ...process.env, SHELL: shell },
    encoding: "utf-8",
  });
};

test("postinstall shows only bash instruction when SHELL is /bin/bash", () => {
  const output = run("/bin/bash");
  assert.match(output, /eval "\$\(gsmart completions bash\)"/);
  assert.match(output, /Enable bash completions/);
  assert.doesNotMatch(output, /zshrc/);
  assert.doesNotMatch(output, /fish/);
});

test("postinstall shows only zsh instruction when SHELL is /bin/zsh", () => {
  const output = run("/bin/zsh");
  assert.match(output, /eval "\$\(gsmart completions zsh\)"/);
  assert.match(output, /Enable zsh completions/);
  assert.doesNotMatch(output, /bashrc/);
  assert.doesNotMatch(output, /fish/);
});

test("postinstall shows only fish instruction when SHELL is /usr/bin/fish", () => {
  const output = run("/usr/bin/fish");
  assert.match(output, /gsmart completions fish/);
  assert.match(output, /Enable fish completions/);
  assert.doesNotMatch(output, /bashrc/);
  assert.doesNotMatch(output, /zshrc/);
});

test("postinstall shows all instructions when SHELL is empty", () => {
  const output = run("");
  assert.match(output, /bashrc/);
  assert.match(output, /zshrc/);
  assert.match(output, /fish/);
});

test("postinstall shows all instructions when SHELL is unknown", () => {
  const output = run("/bin/ksh");
  assert.match(output, /bashrc/);
  assert.match(output, /zshrc/);
  assert.match(output, /fish/);
});

test("postinstall always shows success message", () => {
  for (const shell of [
    "/bin/bash",
    "/bin/zsh",
    "/usr/bin/fish",
    "",
    "/bin/ksh",
  ]) {
    const output = run(shell);
    assert.match(output, /GSmart installed successfully/);
  }
});
