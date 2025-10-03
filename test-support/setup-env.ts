import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.GSMART_CONFIG_DIR) {
  process.env.GSMART_CONFIG_DIR = mkdtempSync(join(tmpdir(), "gsmart-tests-"));
}
