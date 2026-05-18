import { fileURLToPath } from "node:url";
import updateNotifier from "update-notifier";
import chalk from "chalk";

interface PackageInfo {
  name: string;
  version: string;
}

interface PackageManagerDetectionOptions {
  env?: Record<string, string | undefined>;
  moduleUrl?: string;
}

type PackageManager = "npm" | "pnpm";

const PNPM_PATH_PATTERNS = ["/.pnpm/", "/pnpm/global/", "/share/pnpm/"];

function normalizeModulePath(moduleUrl: string): string {
  try {
    return fileURLToPath(moduleUrl).replace(/\\/g, "/").toLowerCase();
  } catch {
    return moduleUrl.replace(/\\/g, "/").toLowerCase();
  }
}

function hasPnpmHint(value: string | undefined): boolean {
  return value?.toLowerCase().includes("pnpm") ?? false;
}

export function detectPackageManager(
  options: PackageManagerDetectionOptions = {},
): PackageManager {
  const env = options.env ?? process.env;
  const modulePath = normalizeModulePath(options.moduleUrl ?? import.meta.url);

  if (PNPM_PATH_PATTERNS.some((pattern) => modulePath.includes(pattern))) {
    return "pnpm";
  }

  if (hasPnpmHint(env.npm_config_user_agent) || hasPnpmHint(env.npm_execpath)) {
    return "pnpm";
  }

  return "npm";
}

export function getUpdateCommand(
  packageName: string,
  options?: PackageManagerDetectionOptions,
): string {
  if (detectPackageManager(options) === "pnpm") {
    return `pnpm add -g ${packageName}@latest`;
  }

  return `npm install -g ${packageName}@latest`;
}

export function printUpdateNotice(
  pkg: PackageInfo,
  current: string,
  latest: string,
  options?: PackageManagerDetectionOptions,
): void {
  const updateCommand = getUpdateCommand(pkg.name, options);
  const updateCommandPadding = Math.max(0, 44 - updateCommand.length);

  console.log(
    chalk.yellow(
      "\n┌────────────────────────────────────────────────────────────┐",
    ),
  );
  console.log(
    chalk.yellow("│") +
      chalk.bold("  Update available: ") +
      chalk.dim(current) +
      chalk.reset(" → ") +
      chalk.green.bold(latest) +
      " ".repeat(Math.max(0, 40 - current.length - latest.length - 3)) +
      chalk.yellow("│"),
  );
  console.log(
    chalk.yellow("│") +
      chalk.dim(`  Changelog: https://github.com/ragnarok22/gsmart/releases`) +
      " ".repeat(Math.max(0, 2)) +
      chalk.yellow("│"),
  );

  console.log(
    chalk.yellow("│") +
      chalk.cyan(`  Run `) +
      chalk.bold.cyan(updateCommand) +
      chalk.cyan(` to update`) +
      " ".repeat(updateCommandPadding) +
      chalk.yellow("│"),
  );
  console.log(
    chalk.yellow(
      "└────────────────────────────────────────────────────────────┘\n",
    ),
  );
}

/**
 * Checks for available updates and displays a warning if a new version exists
 * @param pkg - Package information containing name and version
 */
export function checkForUpdates(
  pkg: PackageInfo,
  options?: PackageManagerDetectionOptions,
): void {
  const notifier = updateNotifier({
    pkg,
    updateCheckInterval: 1000 * 60 * 60 * 24, // Check once per day
  });

  if (notifier.update) {
    const { current, latest } = notifier.update;
    printUpdateNotice(pkg, current, latest, options);
  }
}
