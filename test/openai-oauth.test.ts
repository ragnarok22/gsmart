import "../test-support/setup-env";

import { request } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAIAuthorizeUrl,
  ensureFreshOpenAIOAuthTokens,
  exchangeOpenAICodeForTokens,
  loginWithOpenAIOAuth,
  refreshOpenAIOAuthTokens,
  isOpenAIOAuthExpired,
} from "../src/utils/openai-oauth.ts";
import type { OpenAIOAuthTokens } from "../src/utils/openai-oauth.ts";

const jwt = (claims: Record<string, unknown>) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "none" })}.${encode(claims)}.sig`;
};

const requestUrl = (url: URL): Promise<{ body: string; statusCode?: number }> =>
  new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          statusCode: res.statusCode,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });

const waitForValue = async <T>(read: () => T | undefined): Promise<T> => {
  for (let i = 0; i < 50; i += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for value");
};

test("buildOpenAIAuthorizeUrl uses Codex-compatible OAuth parameters", () => {
  const url = new URL(
    buildOpenAIAuthorizeUrl({
      issuer: "https://auth.example.test",
      clientId: "client-id",
      redirectUri: "http://localhost:1455/auth/callback",
      codeChallenge: "challenge",
      state: "state",
    }),
  );

  assert.equal(url.origin, "https://auth.example.test");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://localhost:1455/auth/callback",
  );
  assert.equal(url.searchParams.get("code_challenge"), "challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state");
  assert.equal(url.searchParams.get("id_token_add_organizations"), "true");
  assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true");
  assert.ok(url.searchParams.get("scope")?.includes("offline_access"));
});

test("buildOpenAIAuthorizeUrl normalizes issuer and uses environment client id", () => {
  const previousClientId = process.env.GSMART_OPENAI_OAUTH_CLIENT_ID;
  process.env.GSMART_OPENAI_OAUTH_CLIENT_ID = "env-client-id";

  try {
    const url = new URL(
      buildOpenAIAuthorizeUrl({
        issuer: "https://auth.example.test/",
        redirectUri: "http://localhost:1455/auth/callback",
        codeChallenge: "challenge",
        state: "state",
      }),
    );

    assert.equal(url.origin, "https://auth.example.test");
    assert.equal(url.pathname, "/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "env-client-id");
  } finally {
    if (previousClientId) {
      process.env.GSMART_OPENAI_OAUTH_CLIENT_ID = previousClientId;
    } else {
      delete process.env.GSMART_OPENAI_OAUTH_CLIENT_ID;
    }
  }
});

test("exchangeOpenAICodeForTokens stores account id and expiration", async () => {
  const originalFetch = globalThis.fetch;
  const idToken = jwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "account-id" },
  });
  const accessToken = jwt({ exp: 4_102_444_800 });

  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof URLSearchParams);
    assert.equal(init.body.get("grant_type"), "authorization_code");

    return new Response(
      JSON.stringify({
        id_token: idToken,
        access_token: accessToken,
        refresh_token: "refresh-token",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const tokens = await exchangeOpenAICodeForTokens({
      issuer: "https://auth.example.test",
      clientId: "client-id",
      redirectUri: "http://localhost:1455/auth/callback",
      codeVerifier: "verifier",
      code: "code",
    });

    assert.equal(tokens.idToken, idToken);
    assert.equal(tokens.accessToken, accessToken);
    assert.equal(tokens.refreshToken, "refresh-token");
    assert.equal(tokens.accountId, "account-id");
    assert.equal(tokens.expiresAt, 4_102_444_800_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeOpenAICodeForTokens throws on HTTP failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      exchangeOpenAICodeForTokens({
        issuer: "https://auth.example.test",
        clientId: "client-id",
        redirectUri: "http://localhost:1455/auth/callback",
        codeVerifier: "verifier",
        code: "code",
      }),
      /HTTP 401/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeOpenAICodeForTokens requires all token fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ access_token: jwt({ exp: 1 }) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      exchangeOpenAICodeForTokens({
        issuer: "https://auth.example.test",
        clientId: "client-id",
        redirectUri: "http://localhost:1455/auth/callback",
        codeVerifier: "verifier",
        code: "code",
      }),
      /required tokens/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshOpenAIOAuthTokens preserves missing token fields", async () => {
  const originalFetch = globalThis.fetch;
  const current = {
    idToken: jwt({
      "https://api.openai.com/auth": { chatgpt_account_id: "account-id" },
    }),
    accessToken: jwt({ exp: 1 }),
    refreshToken: "old-refresh-token",
    accountId: "account-id",
    expiresAt: 1,
  };

  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(
      new Headers(init?.headers).get("Content-Type"),
      "application/json",
    );

    return new Response(
      JSON.stringify({
        access_token: jwt({ exp: 4_102_444_800 }),
        refresh_token: "new-refresh-token",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const tokens = await refreshOpenAIOAuthTokens(current, {
      issuer: "https://auth.example.test",
      clientId: "client-id",
    });

    assert.equal(tokens.idToken, current.idToken);
    assert.equal(tokens.refreshToken, "new-refresh-token");
    assert.equal(tokens.expiresAt, 4_102_444_800_000);
    assert.equal(tokens.accountId, "account-id");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshOpenAIOAuthTokens uses expires_in and access token account id", async () => {
  const originalFetch = globalThis.fetch;
  const start = Date.now();
  const current = {
    idToken: jwt({}),
    accessToken: jwt({ exp: 1 }),
    refreshToken: "old-refresh-token",
  };
  const accessToken = jwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "access-account" },
  });

  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    assert.equal(body.grant_type, "refresh_token");
    assert.equal(body.refresh_token, "old-refresh-token");

    return new Response(
      JSON.stringify({
        id_token: current.idToken,
        access_token: accessToken,
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const tokens = await refreshOpenAIOAuthTokens(current, {
      issuer: "https://auth.example.test",
      clientId: "client-id",
    });

    assert.equal(tokens.accountId, "access-account");
    assert.equal(tokens.refreshToken, "new-refresh-token");
    assert.ok(tokens.expiresAt);
    assert.ok(tokens.expiresAt >= start + 3600_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshOpenAIOAuthTokens throws on HTTP failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("server error", { status: 500 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      refreshOpenAIOAuthTokens(
        {
          idToken: jwt({}),
          accessToken: jwt({ exp: 1 }),
          refreshToken: "refresh-token",
        },
        { issuer: "https://auth.example.test", clientId: "client-id" },
      ),
      /HTTP 500/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ensureFreshOpenAIOAuthTokens returns fresh tokens without refreshing", async () => {
  const tokens = {
    idToken: jwt({}),
    accessToken: jwt({}),
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 10 * 60_000,
  };
  let refreshed = false;

  const result = await ensureFreshOpenAIOAuthTokens(tokens, () => {
    refreshed = true;
  });

  assert.equal(result, tokens);
  assert.equal(refreshed, false);
});

test("ensureFreshOpenAIOAuthTokens refreshes expired tokens", async () => {
  const originalFetch = globalThis.fetch;
  const tokens = {
    idToken: jwt({}),
    accessToken: jwt({ exp: 1 }),
    refreshToken: "refresh-token",
    expiresAt: 1,
  };

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        id_token: jwt({}),
        access_token: jwt({ exp: 4_102_444_800 }),
        refresh_token: "new-refresh-token",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    let savedTokens: OpenAIOAuthTokens | undefined;
    const result = await ensureFreshOpenAIOAuthTokens(tokens, (refreshed) => {
      savedTokens = refreshed;
    });

    assert.equal(result.refreshToken, "new-refresh-token");
    assert.equal(savedTokens?.refreshToken, "new-refresh-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loginWithOpenAIOAuth resolves tokens from local callback", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  let authorizeUrl: string | undefined;
  const idToken = jwt({});
  const accessToken = jwt({ exp: 4_102_444_800 });

  console.log = (message?: unknown) => {
    const [, url] = String(message).split("\n");
    authorizeUrl = url;
  };
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof URLSearchParams);
    assert.equal(init.body.get("grant_type"), "authorization_code");
    assert.equal(init.body.get("code"), "callback-code");

    return new Response(
      JSON.stringify({
        id_token: idToken,
        access_token: accessToken,
        refresh_token: "refresh-token",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const login = loginWithOpenAIOAuth({
    issuer: "https://auth.example.test",
    clientId: "client-id",
    openBrowser: false,
    ports: [0],
    timeoutMs: 1000,
  });

  try {
    const url = new URL(await waitForValue(() => authorizeUrl));
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    assert.ok(redirectUri);
    assert.ok(state);

    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("state", state);
    callbackUrl.searchParams.set("code", "callback-code");

    const callbackResponse = await requestUrl(callbackUrl);
    assert.equal(callbackResponse.statusCode, 200);
    assert.ok(callbackResponse.body.includes("gsmart is connected"));

    const tokens = await login;
    assert.equal(tokens.idToken, idToken);
    assert.equal(tokens.accessToken, accessToken);
    assert.equal(tokens.refreshToken, "refresh-token");
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    await login.catch(() => undefined);
  }
});

test("isOpenAIOAuthExpired refreshes before expiration", () => {
  assert.equal(isOpenAIOAuthExpired({} as never), true);
  assert.equal(
    isOpenAIOAuthExpired({ expiresAt: Date.now() + 60_000 } as never),
    true,
  );
  assert.equal(
    isOpenAIOAuthExpired({ expiresAt: Date.now() + 10 * 60_000 } as never),
    false,
  );
});
