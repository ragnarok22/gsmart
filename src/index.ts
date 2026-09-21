#!/usr/bin/env node
//  _____  _____                          _
// |  __ \/  ___|                        | |
// | |  \/\ `--.  _ __ ___    __ _  _ __ | |_
// | | __  `--. \| '_ ` _ \  / _` || '__|| __|
// | |_\ \/\__/ /| | | | | || (_| || |   | |_
//  \____/\____/ |_| |_| |_| \__,_||_|    \__| CLI
//  Created by: Reinier Hernández

import commands from "./gsmart";
import info from "./build-info";
import { createProgram } from "./program";
import { checkForUpdates } from "./utils/version-check";
import { showHolidayMessage } from "./utils/holiday";
import { enableDebug, debugLog } from "./utils/debug";
import { showWelcomeOnce } from "./utils/welcome";
import { dispatchInterrupt } from "./utils/interrupt";

// Handle SIGINT and SIGTERM signals to exit the process gracefully
const handleSigTerm = (signal: NodeJS.Signals) => {
  const exit = () => process.exit(0);
  if (!dispatchInterrupt(signal, signal === "SIGTERM" ? exit : undefined))
    exit();
};

process.on("SIGINT", () => handleSigTerm("SIGINT"));
process.on("SIGTERM", () => handleSigTerm("SIGTERM"));

async function main() {
  const program = createProgram({
    commands,
    metadata: info,
    onDebug: () => {
      enableDebug();
      debugLog("cli", `version: ${info.version}`);
      debugLog("cli", `command: ${process.argv.slice(2).join(" ")}`);
    },
    beforeAction: () => {
      checkForUpdates({ name: info.name, version: info.version });
      showWelcomeOnce(process.env.SHELL);
    },
    afterAction: () => {
      if (!process.exitCode) showHolidayMessage();
    },
  });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
