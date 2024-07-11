import ora from "ora";
import chalk from "chalk";
import prompts from "prompts";
import { ICommand } from "./definitions";
import { getGitBranch, getGitChanges } from "./utils/git";
import { providers } from "./utils/ai";

const MainCommand: ICommand = {
  name: "gsmart",
  default: true,
  description: "Get the current git branch",
  action: async () => {
    const spinner = ora('').start();
    const branch = await getGitBranch();
    const changes = await getGitChanges();
    spinner.stop();
    console.log(chalk.green(branch));
    console.log(chalk.gray(changes));
  }
}

/**
 * Login command to paste the API key
**/
const LoginCommand: ICommand = {
  name: "login",
  description: "",
  action: async () => {
    const { provider } = await prompts({
      type: "select",
      name: "provider",
      message: "Select a provider",
      hint: "Use arrow keys to navigate",
      choices: providers.filter(p => p.active).map(p => ({
        title: p.title,
        value: p.value
      }))
    });
    console.log("Selected provider:", provider);
  }
}

export default [MainCommand, LoginCommand];
