import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { createResetCommand } from "../src/commands/reset.ts";

const createSpinner = (messages: string[]) => {
  const spinner = {
    fail: (message: string) => {
      messages.push(message);
      return spinner;
    },
    succeed: (message: string) => {
      messages.push(message);
      return spinner;
    },
  };
  return spinner;
};

test("reset clears config when user confirms", async () => {
  let clearCalled = false;
  const messages: string[] = [];

  const ResetCommand = createResetCommand({
    prompt: async () => ({ confirm: true }),
    spinner: () => createSpinner(messages) as never,
    config: {
      clear: () => {
        clearCalled = true;
      },
    },
  });

  await ResetCommand.action({});

  assert.equal(clearCalled, true);
  assert.deepEqual(messages, ["Configuration reset successfully"]);
});

test("reset aborts when user declines confirmation", async () => {
  let clearCalled = false;
  const messages: string[] = [];

  const ResetCommand = createResetCommand({
    prompt: async () => ({ confirm: false }),
    spinner: () => createSpinner(messages) as never,
    config: {
      clear: () => {
        clearCalled = true;
      },
    },
  });

  await ResetCommand.action({});

  assert.equal(clearCalled, false);
  assert.deepEqual(messages, ["Operation cancelled"]);
});

test("reset with --force skips confirmation and clears config", async () => {
  let clearCalled = false;
  let promptsCalled = false;
  const messages: string[] = [];

  const ResetCommand = createResetCommand({
    prompt: async () => {
      promptsCalled = true;
      return {};
    },
    spinner: () => createSpinner(messages) as never,
    config: {
      clear: () => {
        clearCalled = true;
      },
    },
  });

  await ResetCommand.action({ force: true });

  assert.equal(clearCalled, true);
  assert.equal(promptsCalled, false);
  assert.deepEqual(messages, ["Configuration reset successfully"]);
});

test("reset aborts when prompt is dismissed", async () => {
  let clearCalled = false;
  const messages: string[] = [];

  const ResetCommand = createResetCommand({
    prompt: async () => ({ confirm: undefined }),
    spinner: () => createSpinner(messages) as never,
    config: {
      clear: () => {
        clearCalled = true;
      },
    },
  });

  await ResetCommand.action({});

  assert.equal(clearCalled, false);
  assert.deepEqual(messages, ["Operation cancelled"]);
});

test("reset command has correct metadata", () => {
  const ResetCommand = createResetCommand();

  assert.equal(ResetCommand.name, "reset");
  assert.equal(typeof ResetCommand.description, "string");
  assert.ok(ResetCommand.options?.some((o) => o.flags.includes("--force")));
});
