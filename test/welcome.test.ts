import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

function buildWelcome(
  overrides: { welcomeShown?: boolean; shell?: string } = {},
) {
  const { welcomeShown = false } = overrides;

  let storedWelcomeShown = welcomeShown;
  const logs: string[] = [];

  const load = async () => {
    const mod = await esmock("../src/utils/welcome.ts", {
      "../src/utils/config.ts": {
        default: {
          getWelcomeShown: () => storedWelcomeShown,
          setWelcomeShown: (val: boolean) => {
            storedWelcomeShown = val;
          },
        },
      },
    });
    return mod.showWelcomeOnce as (shell?: string) => void;
  };

  return {
    load,
    logs,
    getStored: () => storedWelcomeShown,
    captureLogs(fn: () => void) {
      const original = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));
      try {
        fn();
      } finally {
        console.log = original;
      }
    },
  };
}

test("shows welcome message on first run", async () => {
  const ctx = buildWelcome({ welcomeShown: false });
  const showWelcomeOnce = await ctx.load();

  ctx.captureLogs(() => showWelcomeOnce("/bin/zsh"));

  const output = ctx.logs.join("\n");
  assert.match(output, /GSmart installed successfully/);
  assert.match(output, /completions zsh/);
});

test("does not show welcome message on subsequent runs", async () => {
  const ctx = buildWelcome({ welcomeShown: true });
  const showWelcomeOnce = await ctx.load();

  ctx.captureLogs(() => showWelcomeOnce("/bin/zsh"));

  assert.equal(ctx.logs.length, 0);
});

test("marks welcome as shown after first display", async () => {
  const ctx = buildWelcome({ welcomeShown: false });
  const showWelcomeOnce = await ctx.load();

  ctx.captureLogs(() => showWelcomeOnce("/bin/zsh"));

  assert.equal(ctx.getStored(), true);
});

test("shows bash instructions when shell is /bin/bash", async () => {
  const ctx = buildWelcome({ welcomeShown: false });
  const showWelcomeOnce = await ctx.load();

  ctx.captureLogs(() => showWelcomeOnce("/bin/bash"));

  const output = ctx.logs.join("\n");
  assert.match(output, /completions bash/);
  assert.doesNotMatch(output, /zshrc/);
});

test("shows fish instructions when shell is /usr/bin/fish", async () => {
  const ctx = buildWelcome({ welcomeShown: false });
  const showWelcomeOnce = await ctx.load();

  ctx.captureLogs(() => showWelcomeOnce("/usr/bin/fish"));

  const output = ctx.logs.join("\n");
  assert.match(output, /completions fish/);
  assert.doesNotMatch(output, /bashrc/);
});

test("shows all instructions when shell is unknown", async () => {
  const ctx = buildWelcome({ welcomeShown: false });
  const showWelcomeOnce = await ctx.load();

  ctx.captureLogs(() => showWelcomeOnce("/bin/ksh"));

  const output = ctx.logs.join("\n");
  assert.match(output, /bashrc/);
  assert.match(output, /zshrc/);
  assert.match(output, /fish/);
});
