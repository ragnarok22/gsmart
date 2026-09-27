import "./setup-env";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// Suites that exercise the real store must remain isolated even when CI supplies
// one GSMART_CONFIG_DIR shared by all concurrently running test-file processes.
const previous = process.env.GSMART_CONFIG_DIR;
const directory = mkdtempSync(join(tmpdir(), "gsmart-provider-tests-"));
process.env.GSMART_CONFIG_DIR = directory;
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.GSMART_CONFIG_DIR;
  else process.env.GSMART_CONFIG_DIR = previous;
});
