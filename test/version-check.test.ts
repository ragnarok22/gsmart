import "../test-support/setup-env";

import test, { mock } from "node:test";
import assert from "node:assert/strict";
// Mock console.log to capture output

const createChalkMock = () => {
  const bold = Object.assign((message: string) => `[bold]${message}[/bold]`, {
    cyan: (message: string) => `[bold.cyan]${message}[/bold.cyan]`,
  });

  return {
    bold,
    cyan: (message: string) => `[cyan]${message}[/cyan]`,
    dim: (message: string) => `[dim]${message}[/dim]`,
    green: {
      bold: (message: string) => `[green.bold]${message}[/green.bold]`,
    },
    reset: (message: string) => `[reset]${message}[/reset]`,
    yellow: (message: string) => `[yellow]${message}[/yellow]`,
  };
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

test("checkForUpdates calls update-notifier with package info", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const updateNotifierSpy = mock.fn(() => ({ update: null }));
  const updateNotifierMock = mock.module("update-notifier", {
    defaultExport: updateNotifierSpy,
  });

  const pkg = { name: "gsmart", version: "1.2.3" };

  const logs = await captureConsoleLogAsync(async () => {
    const { checkForUpdates: checkWithMock } =
      await import("../src/utils/version-check.ts?call-args");
    checkWithMock(pkg);
  });

  updateNotifierMock.restore();
  mock.reset();

  assert.equal(updateNotifierSpy.mock.calls.length, 1);
  assert.deepEqual(updateNotifierSpy.mock.calls[0].arguments[0], {
    pkg,
    updateCheckInterval: 1000 * 60 * 60 * 24,
  });
  assert.equal(logs.length, 0);
});

test("checkForUpdates accepts valid package info", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const updateNotifierSpy = mock.fn(() => ({ update: null }));
  const updateNotifierMock = mock.module("update-notifier", {
    defaultExport: updateNotifierSpy,
  });

  const validPackages = [
    { name: "gsmart", version: "1.0.0" },
    { name: "test-pkg", version: "0.0.1" },
    { name: "@scope/package", version: "2.3.4" },
  ];

  const logs = await captureConsoleLogAsync(async () => {
    const { checkForUpdates: checkWithMock } =
      await import("../src/utils/version-check.ts?valid-packages");
    for (const pkg of validPackages) {
      assert.doesNotThrow(() => {
        checkWithMock(pkg);
      }, `Should accept package: ${pkg.name}@${pkg.version}`);
    }
  });

  updateNotifierMock.restore();
  mock.reset();

  assert.equal(logs.length, 0);
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
    const { checkForUpdates: checkWithMock } =
      await import("../src/utils/version-check.ts?update-available");
    checkWithMock({ name: "gsmart", version: "1.0.0" });
  });

  updateNotifierMock.restore();
  mock.reset();

  assert(logs.some((line) => line.includes("Update available")));
  assert(logs.some((line) => line.includes("1.0.0")));
  assert(logs.some((line) => line.includes("1.2.0")));
});

test("checkForUpdates prints formatted update notice with package name", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const chalkMock = createChalkMock();
  const updateNotifierMock = mock.module("update-notifier", {
    defaultExport: () => ({
      update: {
        current: "0.9.0",
        latest: "1.0.0",
      },
    }),
  });
  const chalkModuleMock = mock.module("chalk", {
    defaultExport: chalkMock,
  });

  const logs = await captureConsoleLogAsync(async () => {
    const { checkForUpdates: checkWithMock } =
      await import("../src/utils/version-check.ts?formatted-message");
    checkWithMock({ name: "@scope/gsmart", version: "0.9.0" });
  });

  updateNotifierMock.restore();
  chalkModuleMock.restore();
  mock.reset();

  assert.equal(logs.length, 5);
  assert.equal(
    logs[0],
    "[yellow]\n┌────────────────────────────────────────────────────────────┐[/yellow]",
  );
  assert(
    logs[1].includes("[bold]  Update available: [/bold]"),
    "expected update headline to be bold",
  );
  assert(
    logs[1].includes("[dim]0.9.0[/dim]") &&
      logs[1].includes("[green.bold]1.0.0[/green.bold]"),
    "expected current and latest versions to be highlighted",
  );
  assert(
    logs[2].includes(
      "Changelog: https://github.com/ragnarok22/gsmart/releases",
    ),
    "expected changelog link",
  );
  assert(
    logs[3].includes("npm install -g @scope/gsmart"),
    "expected install command with package name",
  );
  assert.equal(
    logs[4],
    "[yellow]└────────────────────────────────────────────────────────────┘\n[/yellow]",
  );
});

test("checkForUpdates pads update message rows with spaces", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("mock.module is not available in this Node version");
    return;
  }

  const chalkMock = createChalkMock();
  const updateNotifierMock = mock.module("update-notifier", {
    defaultExport: () => ({
      update: {
        current: "1.0.0",
        latest: "1.0.10",
      },
    }),
  });
  const chalkModuleMock = mock.module("chalk", {
    defaultExport: chalkMock,
  });

  const logs = await captureConsoleLogAsync(async () => {
    const { checkForUpdates: checkWithMock } =
      await import("../src/utils/version-check.ts?padding");
    checkWithMock({ name: "gsmart", version: "1.0.0" });
  });

  updateNotifierMock.restore();
  chalkModuleMock.restore();
  mock.reset();

  assert(logs[1].includes("  Update available: "));
  assert(
    logs[1].match(/\s+\[yellow\]│\[\/yellow\]$/),
    "expected update row to pad spaces before the closing border",
  );
  assert(
    logs[2].match(/\s+\[yellow\]│\[\/yellow\]$/),
    "expected changelog row to pad spaces before the closing border",
  );
  assert(
    logs[3].match(/\s+\[yellow\]│\[\/yellow\]$/),
    "expected install row to pad spaces before the closing border",
  );
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
    const { checkForUpdates: checkWithMock } =
      await import("../src/utils/version-check.ts?update-none");
    checkWithMock({ name: "gsmart", version: "1.0.0" });
  });

  updateNotifierMock.restore();
  mock.reset();

  assert.equal(logs.length, 0);
});
