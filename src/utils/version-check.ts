import updateNotifier from "update-notifier";
import chalk from "chalk";

interface PackageInfo {
  name: string;
  version: string;
}

/**
 * Checks for available updates and displays a warning if a new version exists
 * @param pkg - Package information containing name and version
 */
export function checkForUpdates(pkg: PackageInfo): void {
  const notifier = updateNotifier({
    pkg,
    updateCheckInterval: 1000 * 60 * 60 * 24, // Check once per day
  });

  if (notifier.update) {
    const { current, latest } = notifier.update;

    console.log(
      chalk.yellow("\n┌───────────────────────────────────────────────────┐"),
    );
    console.log(
      chalk.yellow("│") +
        chalk.bold("  Update available: ") +
        chalk.dim(current) +
        chalk.reset(" → ") +
        chalk.green.bold(latest) +
        " ".repeat(Math.max(0, 30 - current.length - latest.length - 3)) +
        chalk.yellow("│"),
    );
    console.log(
      chalk.yellow("│") +
        chalk.dim(
          `  Changelog: https://github.com/ragnarok22/gsmart/releases`,
        ) +
        " ".repeat(Math.max(0, 1)) +
        chalk.yellow("│"),
    );
    console.log(
      chalk.yellow("│") +
        chalk.cyan(`  Run `) +
        chalk.bold.cyan(`npm install -g ${pkg.name}`) +
        chalk.cyan(` to update`) +
        " ".repeat(Math.max(0, 6)) +
        chalk.yellow("│"),
    );
    console.log(
      chalk.yellow("└───────────────────────────────────────────────────┘\n"),
    );
  }
}
