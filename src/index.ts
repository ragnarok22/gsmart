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
import { getPackageInfo } from "./utils/get-package-info";

// Handle SIGINT and SIGTERM signals to exit the process gracefully
const handleSigTerm = () => process.exit(0)

process.on('SIGINT', handleSigTerm)
process.on('SIGTERM', handleSigTerm)

async function main() {
  // Define the program
  const program = new Command();
  const packageJson = getPackageInfo();

  program
    .name(packageJson.name || "gsmart")
    .version(packageJson.version || "latest")
    .description(packageJson.description || "GSmart CLI");

  for (const command of commands) {
    const cmd = program
      .command(command.name, { isDefault: command.default })
      .description(command.description)

    if (command.options) {
      for (const opt of command.options) {
        cmd.option(opt.flags, opt.description, opt.default);
      }
    }

    cmd.action(() => {
      const opts = cmd.opts()
      command.action(opts);
    });
  }

  program.parse(process.argv);
}

main();
