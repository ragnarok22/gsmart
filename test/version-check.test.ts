import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

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

test("checkForUpdates calls update-notifier with package info", async () => {
  let capturedArgs: unknown = null;
  const { checkForUpdates } = await esmock("../src/utils/version-check.ts", {
    "update-notifier": {
      default: (args: unknown) => {
        capturedArgs = args;
        return { update: null };
      },
    },
  });

  const pkg = { name: "gsmart", version: "1.2.3" };
  const logs = captureConsoleLogs(() => {
    checkForUpdates(pkg);
  });

  assert.deepEqual(capturedArgs, {
    pkg,
    updateCheckInterval: 1000 * 60 * 60 * 24,
  });
  assert.equal(logs.length, 0);
});

test("checkForUpdates accepts valid package info", async () => {
  const { checkForUpdates } = await esmock("../src/utils/version-check.ts", {
    "update-notifier": {
      default: () => ({ update: null }),
    },
  });

  const validPackages = [
    { name: "gsmart", version: "1.0.0" },
    { name: "test-pkg", version: "0.0.1" },
    { name: "@scope/package", version: "2.3.4" },
  ];

  const logs = captureConsoleLogs(() => {
    for (const pkg of validPackages) {
      assert.doesNotThrow(() => {
        checkForUpdates(pkg);
      }, `Should accept package: ${pkg.name}@${pkg.version}`);
    }
  });

  assert.equal(logs.length, 0);
});

test("checkForUpdates logs update details when update is available", async () => {
  const { checkForUpdates } = await esmock("../src/utils/version-check.ts", {
    "update-notifier": {
      default: () => ({
        update: {
          current: "1.0.0",
          latest: "1.2.0",
        },
      }),
    },
  });

  const logs = captureConsoleLogs(() => {
    checkForUpdates({ name: "gsmart", version: "1.0.0" });
  });

  assert(logs.some((line) => line.includes("Update available")));
  assert(logs.some((line) => line.includes("1.0.0")));
  assert(logs.some((line) => line.includes("1.2.0")));
});

test("checkForUpdates prints formatted update notice with package name", async () => {
  const chalkMock = createChalkMock();
  const { checkForUpdates } = await esmock("../src/utils/version-check.ts", {
    "update-notifier": {
      default: () => ({
        update: {
          current: "0.9.0",
          latest: "1.0.0",
        },
      }),
    },
    chalk: {
      default: chalkMock,
    },
  });

  const logs = captureConsoleLogs(() => {
    checkForUpdates({ name: "@scope/gsmart", version: "0.9.0" });
  });

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

test("checkForUpdates pads update message rows with spaces", async () => {
  const chalkMock = createChalkMock();
  const { checkForUpdates } = await esmock("../src/utils/version-check.ts", {
    "update-notifier": {
      default: () => ({
        update: {
          current: "1.0.0",
          latest: "1.0.10",
        },
      }),
    },
    chalk: {
      default: chalkMock,
    },
  });

  const logs = captureConsoleLogs(() => {
    checkForUpdates({ name: "gsmart", version: "1.0.0" });
  });

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

test("checkForUpdates does not log when no update is available", async () => {
  const { checkForUpdates } = await esmock("../src/utils/version-check.ts", {
    "update-notifier": {
      default: () => ({ update: null }),
    },
  });

  const logs = captureConsoleLogs(() => {
    checkForUpdates({ name: "gsmart", version: "1.0.0" });
  });

  assert.equal(logs.length, 0);
});
