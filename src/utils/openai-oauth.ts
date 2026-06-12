import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { URL } from "node:url";

export type OpenAIOAuthTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId?: string;
  expiresAt?: number;
};

type TokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type PkceCodes = {
  verifier: string;
  challenge: string;
};

type LoginOptions = {
  issuer?: string;
  clientId?: string;
  openBrowser?: boolean;
  ports?: number[];
  timeoutMs?: number;
};

type ListeningServer = {
  server: Server;
  port: number;
};

const DEFAULT_ISSUER = "https://auth.openai.com";
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_PORTS = [1455, 1457];
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const REFRESH_GRACE_MS = 5 * 60 * 1000;

const base64Url = (buffer: Buffer): string =>
  buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const generatePkce = (): PkceCodes => {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());

  return { verifier, challenge };
};

const generateState = (): string => base64Url(randomBytes(32));

const normalizeIssuer = (issuer?: string): string =>
  (issuer || process.env.GSMART_OPENAI_OAUTH_ISSUER || DEFAULT_ISSUER).replace(
    /\/$/,
    "",
  );

const resolveClientId = (clientId?: string): string =>
  clientId || process.env.GSMART_OPENAI_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;

  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const authClaims = (token: string): Record<string, unknown> => {
  const payload = parseJwtPayload(token);
  const claims = payload?.["https://api.openai.com/auth"];

  return claims && typeof claims === "object"
    ? (claims as Record<string, unknown>)
    : {};
};

const parseExpiration = (token: string): number | undefined => {
  const exp = parseJwtPayload(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
};

const accountIdFrom = (
  idToken: string,
  accessToken: string,
): string | undefined => {
  const idTokenAccount = authClaims(idToken).chatgpt_account_id;
  if (typeof idTokenAccount === "string" && idTokenAccount)
    return idTokenAccount;

  const accessTokenAccount = authClaims(accessToken).chatgpt_account_id;
  return typeof accessTokenAccount === "string" && accessTokenAccount
    ? accessTokenAccount
    : undefined;
};

const toTokens = (
  response: TokenResponse,
  current?: OpenAIOAuthTokens,
): OpenAIOAuthTokens => {
  const idToken = response.id_token || current?.idToken;
  const accessToken = response.access_token || current?.accessToken;
  const refreshToken = response.refresh_token || current?.refreshToken;

  if (!idToken || !accessToken || !refreshToken) {
    throw new Error(
      "OpenAI OAuth response did not include the required tokens",
    );
  }

  const expiresAt = response.expires_in
    ? Date.now() + response.expires_in * 1000
    : parseExpiration(accessToken);

  return {
    idToken,
    accessToken,
    refreshToken,
    accountId: accountIdFrom(idToken, accessToken),
    expiresAt,
  };
};

export function isOpenAIOAuthExpired(tokens: OpenAIOAuthTokens): boolean {
  return !tokens.expiresAt || tokens.expiresAt - REFRESH_GRACE_MS <= Date.now();
}

export function buildOpenAIAuthorizeUrl(params: {
  issuer?: string;
  clientId?: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const issuer = normalizeIssuer(params.issuer);
  const url = new URL(`${issuer}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", resolveClientId(params.clientId));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set(
    "scope",
    "openid profile email offline_access api.connectors.read api.connectors.invoke",
  );
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("state", params.state);
  url.searchParams.set("originator", "gsmart_cli");

  return url.toString();
}

export async function exchangeOpenAICodeForTokens(params: {
  issuer?: string;
  clientId?: string;
  redirectUri: string;
  codeVerifier: string;
  code: string;
}): Promise<OpenAIOAuthTokens> {
  const issuer = normalizeIssuer(params.issuer);
  const response = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: resolveClientId(params.clientId),
      code_verifier: params.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI OAuth token exchange failed with HTTP ${response.status}`,
    );
  }

  return toTokens((await response.json()) as TokenResponse);
}

export async function refreshOpenAIOAuthTokens(
  tokens: OpenAIOAuthTokens,
  options: Pick<LoginOptions, "issuer" | "clientId"> = {},
): Promise<OpenAIOAuthTokens> {
  const issuer = normalizeIssuer(options.issuer);
  const response = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: resolveClientId(options.clientId),
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI OAuth token refresh failed with HTTP ${response.status}`,
    );
  }

  return toTokens((await response.json()) as TokenResponse, tokens);
}

export async function ensureFreshOpenAIOAuthTokens(
  tokens: OpenAIOAuthTokens,
  onRefresh: (tokens: OpenAIOAuthTokens) => void,
): Promise<OpenAIOAuthTokens> {
  if (!isOpenAIOAuthExpired(tokens)) return tokens;

  const refreshed = await refreshOpenAIOAuthTokens(tokens);
  onRefresh(refreshed);
  return refreshed;
}

const openUrl = (url: string): void => {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

const listen = (server: Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });

const listenOnPort = async (port: number): Promise<ListeningServer> => {
  const server = createServer();
  const actualPort = await listen(server, port);
  return { server, port: actualPort };
};

const closeServer = (server: Server): void => {
  server.close(() => undefined);
};

const startCallbackServer = async (
  ports: readonly number[],
): Promise<ListeningServer> => {
  const attempts = await Promise.allSettled(
    ports.map((port) => listenOnPort(port)),
  );

  let selected: ListeningServer | undefined;
  for (const attempt of attempts) {
    if (attempt.status !== "fulfilled") continue;
    if (!selected) {
      selected = attempt.value;
      continue;
    }

    closeServer(attempt.value.server);
  }

  if (!selected) {
    throw new Error("Unable to start local OpenAI OAuth callback server");
  }

  return selected;
};

export async function loginWithOpenAIOAuth(
  options: LoginOptions = {},
): Promise<OpenAIOAuthTokens> {
  const issuer = normalizeIssuer(options.issuer);
  const clientId = resolveClientId(options.clientId);
  const pkce = generatePkce();
  const state = generateState();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { server, port: actualPort } = await startCallbackServer(
    options.ports ?? DEFAULT_PORTS,
  );

  const redirectUri = `http://localhost:${actualPort}/auth/callback`;
  const authUrl = buildOpenAIAuthorizeUrl({
    issuer,
    clientId,
    redirectUri,
    codeChallenge: pkce.challenge,
    state,
  });

  console.log(`Open this URL to authorize gsmart with ChatGPT:\n${authUrl}`);
  if (options.openBrowser !== false) openUrl(authUrl);

  return await new Promise<OpenAIOAuthTokens>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OpenAI OAuth login timed out"));
    }, timeoutMs);

    server.on("request", async (request, response) => {
      const url = new URL(request.url || "/", `http://localhost:${actualPort}`);
      if (url.pathname !== "/auth/callback") {
        response.writeHead(404).end("Not found");
        return;
      }

      const receivedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (receivedState !== state) {
        response.writeHead(400).end("State mismatch");
        clearTimeout(timer);
        server.close();
        reject(new Error("OpenAI OAuth state mismatch"));
        return;
      }

      if (!code) {
        response.writeHead(400).end("Missing authorization code");
        clearTimeout(timer);
        server.close();
        reject(new Error("OpenAI OAuth callback did not include a code"));
        return;
      }

      try {
        const tokens = await exchangeOpenAICodeForTokens({
          issuer,
          clientId,
          redirectUri,
          codeVerifier: pkce.verifier,
          code,
        });
        response
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(
            "<h1>gsmart is connected</h1><p>You can close this tab and return to your terminal.</p>",
          );
        clearTimeout(timer);
        server.close();
        resolve(tokens);
      } catch (error) {
        response.writeHead(500).end("OpenAI OAuth token exchange failed");
        clearTimeout(timer);
        server.close();
        reject(error);
      }
    });
  });
}
