import "../test-support/setup-env";

import test, { mock } from "node:test";
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

const captureConsoleLogAsync = async (
  fn: () => Promise<void>,
): Promise<string[]> => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await fn();
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

test("checkForUpdates logs update details when update is available", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const updateNotifierMock = mock.module("update-notifier", {
    defaultExport: () => ({
      update: {
        current: "1.0.0",
        latest: "1.2.0",
      },
    }),
  });

  const logs = await captureConsoleLogAsync(async () => {
    const { checkForUpdates: checkWithMock } = await import(
      "../src/utils/version-check.ts?update-available"
    );
    checkWithMock({ name: "gsmart", version: "1.0.0" });
  });

  updateNotifierMock.restore();
  mock.reset();

  assert(logs.some((line) => line.includes("Update available")));
  assert(logs.some((line) => line.includes("1.0.0")));
  assert(logs.some((line) => line.includes("1.2.0")));
});

test("checkForUpdates does not log when no update is available", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const updateNotifierMock = mock.module("update-notifier", {
    defaultExport: () => ({
      update: null,
    }),
  });

  const logs = await captureConsoleLogAsync(async () => {
    const { checkForUpdates: checkWithMock } = await import(
      "../src/utils/version-check.ts?update-none"
    );
    checkWithMock({ name: "gsmart", version: "1.0.0" });
  });

  updateNotifierMock.restore();
  mock.reset();

  assert.equal(logs.length, 0);
});
