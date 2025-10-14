#!/usr/bin/env node
//  _____  _____                          _
// |  __ \/  ___|                        | |
// | |  \/\ `--.  _ __ ___    __ _  _ __ | |_
// | | __  `--. \| '_ ` _ \  / _` || '__|| __|
// | |_\ \/\__/ /| | | | | || (_| || |   | |_
//  \____/\____/ |_| |_| |_| \__,_||_|    \__| CLI
//  Created by: Reinier Hernández

import { Command } from "commander";
import commands from "./gsmart";
import info from "./build-info";
import { checkForUpdates } from "./utils/version-check";

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

  for (const command of commands) {
    const cmd = program
      .command(command.name, { isDefault: command.default })
      .description(command.description);

    if (command.options) {
      for (const opt of command.options) {
        cmd.option(opt.flags, opt.description, opt.default);
      }
    }

    cmd.action(async () => {
      const opts = cmd.opts();
      await Promise.resolve(command.action(opts));
    });
  }

  program.parse(process.argv);
}

main();
