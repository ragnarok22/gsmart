#!/usr/bin/env node
//  _____  _____                          _
// |  __ \/  ___|                        | |
// | |  \/\ `--.  _ __ ___    __ _  _ __ | |_
// | | __  `--. \| '_ ` _ \  / _` || '__|| __|
// | |_\ \/\__/ /| | | | | || (_| || |   | |_
//  \____/\____/ |_| |_| |_| \__,_||_|    \__| CLI
//  Created by: Reinier Hernández

import { Argument as CommanderArgument, Command } from "commander";
import commands from "./gsmart";
import info from "./build-info";
import { checkForUpdates } from "./utils/version-check";
import { showHolidayMessage } from "./utils/holiday";
import { enableDebug, debugLog } from "./utils/debug";
import { showWelcomeOnce } from "./utils/welcome";

// Handle SIGINT and SIGTERM signals to exit the process gracefully
const handleSigTerm = () => process.exit(0);

process.on("SIGINT", handleSigTerm);
process.on("SIGTERM", handleSigTerm);

async function main() {
  // Check for updates
  checkForUpdates({ name: info.name, version: info.version });

  // Define the program
  const program = new Command();

  program.name(info.name).version(info.version).description(info.description);
  program.option("-D, --debug", "Enable debug logging", false);

  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.debug) {
      enableDebug();
      debugLog("cli", `version: ${info.version}`);
      debugLog("cli", `command: ${process.argv.slice(2).join(" ")}`);
    }
  });

  for (const command of commands) {
    const cmd = program
      .command(command.name, { isDefault: command.default })
      .description(command.description);

    if (command.options) {
      for (const opt of command.options) {
        cmd.option(opt.flags, opt.description, opt.default);
      }
    }

    if (command.arguments) {
      for (const arg of command.arguments) {
        const syntax = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
        const cmdArg = new CommanderArgument(syntax, arg.description);
        if (arg.choices) {
          cmdArg.choices(arg.choices);
        }
        cmd.addArgument(cmdArg);
      }
    }

    cmd.action(async (...actionArgs: unknown[]) => {
      const opts = cmd.opts();
      if (command.arguments) {
        command.arguments.forEach((arg, index) => {
          opts[arg.name] = actionArgs[index];
        });
      }
      await Promise.resolve(command.action(opts));
      if (!command.silent) {
        showHolidayMessage();
      }
    });
  }

  showWelcomeOnce(process.env.SHELL);
  program.parse(process.argv);
}

main();
