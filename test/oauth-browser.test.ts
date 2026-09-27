import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, request } from "node:http";
import esmock from "esmock";

test(
  "OAuth remains available for manual authorization when the browser opener is missing",
  { skip: process.platform === "win32" },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
    import assert from "node:assert/strict";
    import { loginWithOpenAIOAuth } from "./src/utils/openai-oauth.ts";
    process.env.PATH = "";
    await assert.rejects(loginWithOpenAIOAuth({ ports: [0], timeoutMs: 100 }), /login timed out/);
    console.log("manual authorization remained available");
  `,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Open this URL/);
    assert.match(result.stdout, /manual authorization remained available/);
    assert.match(result.stderr, /open.*URL.*manually|open.*URL.*continue/i);
    assert.doesNotMatch(result.stderr, /ENOENT|Unhandled 'error'/);
  },
);

for (const failure of [
  "error",
  "nonzero",
  "signal",
  "throw",
  "none",
] as const) {
  test(`manual OAuth authorization completes after browser opener result: ${failure}`, async (t) => {
    let resolveUrl!: (url: URL) => void;
    const authorizeUrl = new Promise<URL>((resolve) => {
      resolveUrl = resolve;
    });
    t.mock.method(console, "log", (message: string) => {
      resolveUrl(new URL(message.split("\n")[1]));
    });
    const warnings: string[] = [];
    t.mock.method(console, "warn", (message: string) => warnings.push(message));
    t.mock.method(globalThis, "fetch", async () => {
      return new Response(
        JSON.stringify({
          id_token: "test-id",
          access_token: "test-access",
          refresh_token: "test-refresh",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const child = Object.assign(new EventEmitter(), { unref: () => undefined });
    const { loginWithOpenAIOAuth } = (await esmock(
      "../src/utils/openai-oauth.ts",
      {
        "node:http": {
          createServer: () => {
            const server = createServer();
            t.after(() => server.close());
            return server;
          },
        },
        "node:child_process": {
          spawn: () => {
            if (failure === "throw")
              throw new Error("sensitive launch details");
            return child;
          },
        },
      },
    )) as typeof import("../src/utils/openai-oauth.ts");
    const login = loginWithOpenAIOAuth({
      issuer: "https://auth.example.test",
      clientId: "test-client",
      ports: [0],
      timeoutMs: 1000,
    });
    // Attach a rejection handler immediately, including for synchronous spawn failures.
    const outcome = login.then(
      (tokens) => ({ tokens }),
      (error: unknown) => ({ error }),
    );
    try {
      const url = await authorizeUrl;
      if (failure === "error") {
        child.emit("error", new Error("sensitive launch details"));
        child.emit("exit", -2, null);
      } else if (failure === "nonzero") {
        child.emit("exit", 1, null);
      } else if (failure === "signal") {
        child.emit("exit", null, "SIGTERM");
      } else if (failure === "none") {
        child.emit("exit", 0, null);
      }

      assert.equal(warnings.length, failure === "none" ? 0 : 1);
      if (failure !== "none") {
        assert.match(warnings[0], /open.*URL.*manually|open.*URL.*continue/i);
        assert.doesNotMatch(warnings[0], /sensitive launch details/);
      }
      const callbackUrl = new URL(url.searchParams.get("redirect_uri")!);
      callbackUrl.hostname = "127.0.0.1";
      callbackUrl.searchParams.set("state", url.searchParams.get("state")!);
      callbackUrl.searchParams.set("code", "manual-code");
      await new Promise<void>((resolve, reject) => {
        const req = request(callbackUrl, (response) => {
          response.resume();
          response.on("end", () => {
            if (response.statusCode === 200) resolve();
            else reject(new Error(`Callback failed: ${response.statusCode}`));
          });
          response.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });
      const result = await outcome;
      assert.ok("tokens" in result);
      assert.equal(result.tokens.accessToken, "test-access");
      assert.equal(result.tokens.refreshToken, "test-refresh");
    } finally {
      await outcome;
    }
  });
}
