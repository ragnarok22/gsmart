#!/usr/bin/env node
//  _____  _____                          _
// |  __ \/  ___|                        | |
// | |  \/\ `--.  _ __ ___    __ _  _ __ | |_
// | | __  `--. \| '_ ` _ \  / _` || '__|| __|
// | |_\ \/\__/ /| | | | | || (_| || |   | |_
//  \____/\____/ |_| |_| |_| \__,_||_|    \__| CLI
//  Created by: Reinier Hernández

import { CommanderError } from "commander";
import { Console } from "node:console";
import info from "./build-info";
import { createProgram } from "./program";
import { enableDebug, debugLog, redactCommandArgs } from "./utils/debug";
import { dispatchInterrupt } from "./utils/interrupt";
import {
  inspectWorkflowArgs,
  isMachineWorkflow,
} from "./utils/generation-options";
import {
  errorMessage,
  WorkflowError,
  workflowFailure,
  writeWorkflowResult,
} from "./utils/workflow-result";

// Inspect before loading configuration so even startup failures honor JSON mode.
const workflowOptions = inspectWorkflowArgs(process.argv.slice(2));
const machine = isMachineWorkflow(workflowOptions);
// Third-party configuration loaders may log too. Reserve stdout for the result;
// Commander help/version and the result writer use their streams directly.
if (machine) globalThis.console = new Console(process.stderr, process.stderr);
let earlySignal: NodeJS.Signals | undefined;
let loaded = false;

// Handle SIGINT and SIGTERM signals to exit the process gracefully
const handleSigTerm = (signal: NodeJS.Signals) => {
  if (machine) {
    if (!dispatchInterrupt(signal)) earlySignal = signal;
    return;
  }
  const exit = () => process.exit(0);
  if (!dispatchInterrupt(signal, signal === "SIGTERM" ? exit : undefined))
    exit();
};

process.on("SIGINT", () => handleSigTerm("SIGINT"));
process.on("SIGTERM", () => handleSigTerm("SIGTERM"));

async function main() {
  const [
    { default: commands },
    { checkForUpdates },
    { showWelcomeOnce },
    { showHolidayMessage },
  ] = await Promise.all([
    import("./gsmart"),
    import("./utils/version-check"),
    import("./utils/welcome"),
    import("./utils/holiday"),
  ]);
  loaded = true;
  if (earlySignal)
    throw new WorkflowError(
      "CANCELED",
      `Generation canceled by ${earlySignal}.`,
    );
  const program = createProgram({
    commands,
    metadata: info,
    onDebug: () => {
      enableDebug();
      debugLog("cli", `version: ${info.version}`);
      debugLog(
        "cli",
        `command: ${redactCommandArgs(process.argv.slice(2)).join(" ")}`,
      );
    },
    beforeAction: () => {
      checkForUpdates({ name: info.name, version: info.version });
      showWelcomeOnce(process.env.SHELL);
    },
    afterAction: () => {
      if (!process.exitCode) showHolidayMessage();
    },
  });

  if (machine) {
    for (const command of [program, ...program.commands])
      command.exitOverride().configureOutput({ outputError: () => {} });
  }

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (machine) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    const code = earlySignal
      ? "CANCELED"
      : error instanceof CommanderError
        ? "USAGE"
        : error instanceof WorkflowError
          ? error.code
          : loaded
            ? "INTERNAL"
            : "CONFIGURATION";
    const detail =
      error instanceof CommanderError
        ? error.message.replace(/^error: /, "")
        : errorMessage(error);
    writeWorkflowResult(
      workflowFailure(
        code,
        earlySignal ? `Generation canceled by ${earlySignal}.` : detail,
      ),
      workflowOptions.output,
    );
    process.exitCode =
      earlySignal === "SIGINT"
        ? 130
        : earlySignal === "SIGTERM"
          ? 143
          : code === "USAGE"
            ? 2
            : 1;
    return;
  }
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
