import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function minimumNodeVersion(range: string): number[] {
  const match = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
  assert.ok(match, `Expected a Node minimum constraint, received ${range}`);
  return [match[1], match[2] ?? "0", match[3] ?? "0"].map(Number);
}

test("the advertised Node minimum supports the installed commitlint loader", () => {
  const project = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const loader = JSON.parse(
    readFileSync(
      new URL("../node_modules/@commitlint/load/package.json", import.meta.url),
      "utf8",
    ),
  );
  const projectMinimum = minimumNodeVersion(project.engines.node);
  const loaderMinimum = minimumNodeVersion(loader.engines.node);
  const firstDifference =
    projectMinimum
      .map((part, index) => part - loaderMinimum[index])
      .find((difference) => difference !== 0) ?? 0;

  assert.ok(
    firstDifference >= 0,
    `GSmart advertises Node ${project.engines.node}, but @commitlint/load@${loader.version} requires ${loader.engines.node}`,
  );
});
