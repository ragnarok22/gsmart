import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdates } from "../src/utils/version-check.ts";

// Mock console.log to capture output
const captureConsoleLog = (fn: () => void): string[] => {
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

test("checkForUpdates does nothing when no update is available", async () => {
  const pkg = {
    name: "gsmart",
    version: "999.999.999", // Very high version, no update should be available
  };

  const logs = captureConsoleLog(() => {
    checkForUpdates(pkg);
  });

  // Should not log anything if no update is available
  assert.equal(logs.length, 0);
});

test("checkForUpdates handles package with name and version", () => {
  const pkg = {
    name: "test-package",
    version: "0.0.1",
  };

  // Should not throw
  assert.doesNotThrow(() => {
    checkForUpdates(pkg);
  });
});

test("checkForUpdates accepts valid package info", () => {
  const validPackages = [
    { name: "gsmart", version: "1.0.0" },
    { name: "test-pkg", version: "0.0.1" },
    { name: "@scope/package", version: "2.3.4" },
  ];

  for (const pkg of validPackages) {
    assert.doesNotThrow(() => {
      checkForUpdates(pkg);
    }, `Should accept package: ${pkg.name}@${pkg.version}`);
  }
});
