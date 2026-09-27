import assert from "node:assert/strict";
import * as module from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { temporaryDirectory } from "../test-support/repository.ts";

const guard = new URL(
  "../test-support/evaluations/offline-guard.mjs",
  import.meta.url,
).href;
const config = new URL("../src/utils/config.ts", import.meta.url).href;

function runGuardProbe(source: string) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 15_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

test("offline evaluation guard avoids deprecated loader registration when synchronous hooks are available", (t) => {
  if (typeof module.registerHooks !== "function") {
    t.skip(
      "Synchronous hooks were introduced after Node 22.14; the policy and offline CLI tests exercise the legacy path",
    );
    return;
  }
  runGuardProbe(`
    import assert from "node:assert/strict";
    import { createRequire, syncBuiltinESMExports } from "node:module";
    const require = createRequire(import.meta.url);
    require("node:module").register = () => {
      throw new Error("Deprecated module.register() called despite synchronous hook support");
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(guard)});
    await import("node:path");
    await assert.rejects(import(${JSON.stringify(config)}), new RegExp("Offline evaluation imported a credential/network dependency"));
    assert.throws(() => fetch("https://example.invalid"), /Offline evaluation attempted a network request/);
  `);
});

test("offline evaluation guard blocks AI, credentials, packages and source network imports with the available hook API", (t) => {
  const directory = temporaryDirectory(t);
  const sourceDirectory = join(directory, "src");
  mkdirSync(sourceDirectory);
  const networkImporter = join(sourceDirectory, "network.mjs");
  writeFileSync(
    networkImporter,
    "export const load = (specifier) => import(specifier);\n",
  );
  const blockedImports = [
    ...["ai", "config", "openai-oauth"].map(
      (name) => new URL(`../src/utils/${name}.ts`, import.meta.url).href,
    ),
    "conf",
    "ai",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
    "@ai-sdk/mistral",
    "@ai-sdk/openai-compatible",
  ].map((specifier) => ({ specifier, url: import.meta.resolve(specifier) }));

  // Match the real CLI's preload order, including its TypeScript loader.
  // Running this on Node 22.14 exercises the actual asynchronous fallback.
  runGuardProbe(`
    import assert from "node:assert/strict";
    await import(${JSON.stringify(guard)});
    await import(${JSON.stringify(import.meta.resolve("tsx"))});
    const blocked = (url) => ({
      message: "Offline evaluation imported a credential/network dependency: " + url,
    });
    for (const { specifier, url } of ${JSON.stringify(blockedImports)}) {
      await assert.rejects(import(specifier), blocked(url));
    }
    const { load } = await import(${JSON.stringify(pathToFileURL(networkImporter).href)});
    assert.equal(typeof (await load("node:path")).join, "function");
    for (const name of ["http", "https", "net", "tls"]) {
      for (const specifier of [name, "node:" + name]) {
        await assert.rejects(load(specifier), blocked("node:" + name));
        // Tooling outside src may import these builtins without making requests.
        await import(specifier);
      }
    }
    assert.throws(() => fetch("https://example.invalid"), {
      message: "Offline evaluation attempted a network request",
    });
  `);
});
