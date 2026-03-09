import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

test("reset clears config when user confirms", async () => {
  let clearCalled = false;

  const ResetCommand = (
    await esmock("../src/commands/reset.ts", {
      prompts: async () => ({ confirm: true }),
      "../src/utils/config.ts": {
        default: {
          clear: () => {
            clearCalled = true;
          },
        },
      },
    })
  ).default;

  await ResetCommand.action({});

  assert.equal(clearCalled, true);
});

test("reset aborts when user declines confirmation", async () => {
  let clearCalled = false;

  const ResetCommand = (
    await esmock("../src/commands/reset.ts", {
      prompts: async () => ({ confirm: false }),
      "../src/utils/config.ts": {
        default: {
          clear: () => {
            clearCalled = true;
          },
        },
      },
    })
  ).default;

  await ResetCommand.action({});

  assert.equal(clearCalled, false);
});

test("reset with --force skips confirmation and clears config", async () => {
  let clearCalled = false;
  let promptsCalled = false;

  const ResetCommand = (
    await esmock("../src/commands/reset.ts", {
      prompts: async () => {
        promptsCalled = true;
        return {};
      },
      "../src/utils/config.ts": {
        default: {
          clear: () => {
            clearCalled = true;
          },
        },
      },
    })
  ).default;

  await ResetCommand.action({ force: true });

  assert.equal(clearCalled, true);
  assert.equal(promptsCalled, false);
});

test("reset aborts when prompt is dismissed (undefined confirm)", async () => {
  let clearCalled = false;

  const ResetCommand = (
    await esmock("../src/commands/reset.ts", {
      prompts: async () => ({ confirm: undefined }),
      "../src/utils/config.ts": {
        default: {
          clear: () => {
            clearCalled = true;
          },
        },
      },
    })
  ).default;

  await ResetCommand.action({});

  assert.equal(clearCalled, false);
});

test("reset command has correct metadata", async () => {
  const ResetCommand = (
    await esmock("../src/commands/reset.ts", {
      prompts: async () => ({}),
      "../src/utils/config.ts": {
        default: { clear: () => {} },
      },
    })
  ).default;

  assert.equal(ResetCommand.name, "reset");
  assert.equal(typeof ResetCommand.description, "string");
  assert.ok(ResetCommand.options?.some((o) => o.flags.includes("--force")));
});
