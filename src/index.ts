import { Command } from "commander";
import { readFileSync } from "fs";
import { join } from "path";

const program = new Command();
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);

program
  .name(packageJson.name)
  .version(packageJson.version)
  .description(packageJson.description);

program
  .command("hello")
  .description("Say hello")
  .action(() => {
    console.log("Hello!");
  });

program.parse(process.argv);
