import path from "path";
import fs from "fs-extra";
import { type PackageJson } from "type-fest";

export function getPackageInfo() {
  // const packageJsonPath = path.join("package.json");

  // return fs.readJSONSync(packageJsonPath) as PackageJson;
  return {
    name: "gsmart",
    version: "0.5.2",
    description: "CLI to generate smart commit messages using AI.",
  }
}
