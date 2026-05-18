import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkForUpdates,
  detectPackageManager,
  getUpdateCommand,
  printUpdateNotice,
} from "../src/utils/version-check";

const captureConsoleLogs = (fn: () => void): string[] => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    fn();
    return logs;
  } finally {
    console.log = originalLog;
  }
};

test("detectPackageManager returns npm without pnpm hints", () => {
  assert.equal(
    detectPackageManager({
      env: {},
      moduleUrl: "file:///usr/local/lib/node_modules/gsmart/dist/index.js",
    }),
    "npm",
  );
});

test("detectPackageManager detects pnpm from install path", () => {
  assert.equal(
    detectPackageManager({
      env: {},
      moduleUrl:
        "file:///Users/test/Library/pnpm/global/5/node_modules/gsmart/dist/index.js",
    }),
    "pnpm",
  );
});

test("detectPackageManager detects pnpm from user agent", () => {
  assert.equal(
    detectPackageManager({
      env: { npm_config_user_agent: "pnpm/11.1.2 npm/? node/v24.0.0" },
      moduleUrl: "file:///usr/local/lib/node_modules/gsmart/dist/index.js",
    }),
    "pnpm",
  );
});

test("detectPackageManager detects pnpm from exec path", () => {
  assert.equal(
    detectPackageManager({
      env: { npm_execpath: "/Users/test/.local/share/pnpm/pnpm.cjs" },
      moduleUrl: "file:///usr/local/lib/node_modules/gsmart/dist/index.js",
    }),
    "pnpm",
  );
});

test("detectPackageManager handles non-file URLs", () => {
  assert.equal(
    detectPackageManager({
      env: {},
      moduleUrl:
        "not-a-file-url:/pnpm/global/node_modules/gsmart/dist/index.js",
    }),
    "pnpm",
  );
});

test("getUpdateCommand returns npm and pnpm commands", () => {
  assert.equal(
    getUpdateCommand("gsmart", {
      env: {},
      moduleUrl: "file:///usr/local/lib/node_modules/gsmart/dist/index.js",
    }),
    "npm install -g gsmart@latest",
  );
  assert.equal(
    getUpdateCommand("@scope/gsmart", {
      env: { npm_config_user_agent: "pnpm/11.1.2" },
      moduleUrl:
        "file:///usr/local/lib/node_modules/@scope/gsmart/dist/index.js",
    }),
    "pnpm add -g @scope/gsmart@latest",
  );
});

test("printUpdateNotice renders pnpm update details", () => {
  const logs = captureConsoleLogs(() => {
    printUpdateNotice({ name: "gsmart", version: "0.9.0" }, "0.9.0", "1.0.0", {
      env: { npm_config_user_agent: "pnpm/11.1.2" },
      moduleUrl: "file:///usr/local/lib/node_modules/gsmart/dist/index.js",
    });
  });

  assert.equal(logs.length, 5);
  assert(logs[1].includes("Update available"));
  assert(logs[1].includes("0.9.0"));
  assert(logs[1].includes("1.0.0"));
  assert(logs[2].includes("https://github.com/ragnarok22/gsmart/releases"));
  assert(logs[3].includes("pnpm add -g gsmart@latest"));
});

test("checkForUpdates stays silent when update-notifier has no cached update", () => {
  const logs = captureConsoleLogs(() => {
    checkForUpdates(
      { name: "gsmart-no-update-test", version: "9999.0.0" },
      {
        env: {},
        moduleUrl: "file:///usr/local/lib/node_modules/gsmart/dist/index.js",
      },
    );
  });

  assert.equal(logs.length, 0);
});
