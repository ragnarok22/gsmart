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
import ora from "ora";
import chalk from "chalk";
import { ICommand } from "./definitions";
import { getGitBranch } from "./utils/git";


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

// Define the commands
const commands: ICommand[] = [
  {
    name: "hello",
    description: "Say hello",
    action: async () => {
      const spinner = ora('').start();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      spinner.stop();
      spinner.clear();
      console.log(await getGitBranch())
      console.log(chalk.green("Hello, World!"))
      console.log(chalk.grey("Hello, World!"))
    },
  },
];

program
  .name(packageJson.name)
  .version(packageJson.version)
  .description(packageJson.description);

for (const command of commands) {
  program
    .command(command.name)
    .description(command.description)
    .action(command.action);
}

program.parse(process.argv);
