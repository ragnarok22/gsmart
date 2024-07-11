import ora from "ora";
import chalk from "chalk";
import { ICommand } from "./definitions";
import { getGitBranch } from "./utils/git";

const Main: ICommand = {
  name: "gsmart",
  description: "Get the current git branch",
  action: async () => {
    const spinner = ora('').start();
    const branch = await getGitBranch();
    spinner.stop();
    console.log(chalk.green(branch));
  }
}

export default [Main];
