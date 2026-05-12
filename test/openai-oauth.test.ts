import "../test-support/setup-env";

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAIAuthorizeUrl,
  exchangeOpenAICodeForTokens,
  refreshOpenAIOAuthTokens,
  isOpenAIOAuthExpired,
} from "../src/utils/openai-oauth.ts";

const jwt = (claims: Record<string, unknown>) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "none" })}.${encode(claims)}.sig`;
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
    assert.equal(init?.headers?.["Content-Type"], "application/json");

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
