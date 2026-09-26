import assert from "node:assert/strict";
import test from "node:test";
import esmock from "esmock";

for (const [name, output, expected] of [
  [
    "stdout only",
    { status: 1, stdout: "hook rejected the commit\n", stderr: "" },
    "hook rejected the commit",
  ],
  [
    "stderr only",
    { status: 1, stdout: "", stderr: "signing failed\n" },
    "signing failed",
  ],
  [
    "both streams",
    { status: 1, stdout: "hook details\n", stderr: "hook rejected commit\n" },
    "hook rejected commit\nhook details",
  ],
  [
    "silent failure",
    { status: 1, stdout: "", stderr: "" },
    "git commit -m feat: candidate",
  ],
  [
    "termination before output",
    { status: null, signal: "SIGTERM", stdout: null, stderr: null },
    "git commit -m feat: candidate",
  ],
] as const) {
  test(`failed Git commits preserve actionable diagnostics for ${name}`, async () => {
    const calls: unknown[][] = [];
    const { commitChanges } = await esmock<
      typeof import("../src/utils/git.ts")
    >("../src/utils/git.ts", {
      "node:child_process": {
        spawnSync: (...args: unknown[]) => {
          calls.push(args);
          return output;
        },
      },
    });
    const errors: Error[] = [];
    assert.equal(
      await commitChanges("feat: candidate", (error) => errors.push(error)),
      false,
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, expected);
    assert.deepEqual(calls, [
      ["git", ["commit", "-m", "feat: candidate"], { encoding: "utf8" }],
    ]);
  });
}
