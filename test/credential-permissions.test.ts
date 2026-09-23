import "../test-support/setup-env";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { temporaryDirectory } from "../test-support/repository.ts";

for (const override of [false, true]) {
  for (const existing of [false, true]) {
    test(
      `credential storage protects ${existing ? "existing" : "new"} files in the ${override ? "override" : "default"} directory with umask 022`,
      { skip: process.platform === "win32" },
      (t) => {
        const home = temporaryDirectory(t);
        const directory = override
          ? join(home, "profiles", "gsmart")
          : process.platform === "darwin"
            ? join(home, "Library", "Preferences", "gsmart-nodejs")
            : join(home, "xdg-config", "gsmart-nodejs");
        const parent = dirname(directory);
        const file = join(directory, "config.json");
        mkdirSync(parent, { recursive: true });
        chmodSync(parent, 0o755);
        if (existing) {
          mkdirSync(directory);
          chmodSync(directory, 0o755);
          writeFileSync(
            file,
            JSON.stringify({ openai: { key: "sk-existing-test" } }),
            { mode: 0o644 },
          );
          chmodSync(file, 0o644);
        }
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "--input-type=module",
            "--eval",
            `
      import assert from "node:assert/strict";
      import { readFileSync, statSync } from "node:fs";
      process.umask(0o022);
      const original = ${existing} ? readFileSync(${JSON.stringify(file)}, "utf8") : null;
      const { default: config } = await import("./src/utils/config.ts");
      assert.equal(process.umask(), 0o022, "initialization restores the caller's umask");
      if (${existing}) {
        assert.equal(config.getKey("openai"), "sk-existing-test");
        assert.equal(statSync(${JSON.stringify(file)}).mode & 0o777, 0o600);
        assert.equal(readFileSync(${JSON.stringify(file)}, "utf8"), original, "initialization must not rewrite credentials");
      }
      config.setKey("openai", "sk-test-not-a-real-key");
      assert.equal(statSync(${JSON.stringify(file)}).mode & 0o777, 0o600);
      config.setOpenAIOAuthTokens({ idToken: "test-id", accessToken: "test-access", refreshToken: "test-refresh" });
      assert.equal(statSync(${JSON.stringify(file)}).mode & 0o777, 0o600);
      config.clearKey("openai");
      assert.equal(config.getOpenAIOAuthTokens().refreshToken, "test-refresh");
    `,
          ],
          {
            encoding: "utf8",
            timeout: 10000,
            env: {
              ...process.env,
              HOME: home,
              XDG_CONFIG_HOME: join(home, "xdg-config"),
              GSMART_CONFIG_DIR: override ? directory : "",
            },
          },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.equal(
          statSync(directory).mode & 0o777,
          existing ? 0o755 : 0o700,
        );
        assert.equal(statSync(parent).mode & 0o777, 0o755);
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /sk-existing-test|sk-test-not-a-real-key|test-access|test-refresh|test-id/,
        );
      },
    );
  }
}

test(
  "new nested config directories are private without changing existing parents",
  { skip: process.platform === "win32" },
  (t) => {
    const parent = temporaryDirectory(t);
    chmodSync(parent, 0o775);
    const directory = join(parent, "new", "nested", "profile");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
          process.umask(0o022);
          const { default: config } = await import("./src/utils/config.ts");
          config.setKey("openai", "sk-test-not-a-real-key");
        `,
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, GSMART_CONFIG_DIR: directory },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(parent).mode & 0o777, 0o775);
    for (const created of [
      join(parent, "new"),
      join(parent, "new", "nested"),
      directory,
    ]) {
      assert.equal(statSync(created).mode & 0o777, 0o700);
    }
  },
);

test("failed config initialization restores the caller's umask", (t) => {
  const directory = temporaryDirectory(t);
  writeFileSync(join(directory, "config.json"), "invalid JSON");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
        import assert from "node:assert/strict";
        process.umask(0o022);
        await assert.rejects(import("./src/utils/config.ts"));
        assert.equal(process.umask(), 0o022);
      `,
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, GSMART_CONFIG_DIR: directory },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
