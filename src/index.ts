#!/usr/bin/env node
//  _____  _____                          _   
// |  __ \/  ___|                        | |  
// | |  \/\ `--.  _ __ ___    __ _  _ __ | |_ 
// | | __  `--. \| '_ ` _ \  / _` || '__|| __|
// | |_\ \/\__/ /| | | | | || (_| || |   | |_ 
//  \____/\____/ |_| |_| |_| \__,_||_|    \__| CLI
//  Created by: Reinier Hernández

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { Command } from "commander";
import commands from "./gsmart";

// Handle SIGINT and SIGTERM signals to exit the process gracefully
const handleSigTerm = () => process.exit(0)

process.on('SIGINT', handleSigTerm)
process.on('SIGTERM', handleSigTerm)

// Define the program
const __dirname = dirname(".");
const program = new Command();
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "/package.json"), "utf-8")
);

program
  .name(packageJson.name)
  .version(packageJson.version)
  .description(packageJson.description);

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
