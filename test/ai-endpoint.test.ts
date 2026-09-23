import "../test-support/setup-env";
import "../test-support/isolated-config";
import assert from "node:assert/strict";
import { beforeEach, afterEach, test, type TestContext } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import esmock from "esmock";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError } from "ai";
import config from "../src/utils/config.ts";
import { AIBuilder } from "../src/utils/ai.ts";
import { repository, git } from "../test-support/repository.ts";
import { sourceDiff } from "../test-support/diff-fixtures.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import {
  estimateTokens,
  REQUEST_OVERHEAD,
} from "../src/utils/context-budget.ts";

beforeEach(() => config.clear());
afterEach(() => config.clear());

const chatResponse = {
  id: "chat-test",
  object: "chat.completion",
  created: 1,
  model: "local-model",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "feat: local inference" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};
const responsesResponse = {
  id: "resp_test",
  object: "response",
  created_at: 1,
  model: "test",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_test",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "feat: hosted inference",
          annotations: [],
        },
      ],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};

async function endpoint(
  t: TestContext,
  status = 200,
  response: unknown = chatResponse,
) {
  const requests: {
    path: string;
    authorization?: string;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    requests.push({
      path: req.url!,
      authorization: req.headers.authorization,
      body: JSON.parse(text),
    });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests };
}

test("keyless custom requests use /chat/completions and never inherit OpenAI credentials", async (t) => {
  const server = await endpoint(t);
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-environment-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  config.setKey("openai", "sk-hosted-secret");
  config.setOpenAIOAuthTokens({
    accessToken: "oauth-secret",
    refreshToken: "refresh-secret",
    idToken: "id-secret",
  });
  config.setCustomBaseURL(server.baseURL + "/");
  config.setModel("custom", "saved-local");
  const builder = new AIBuilder("custom", "Be concise");
  assert.equal(
    await builder.generateCommitMessage("feature/local", "+ changes"),
    "feat: local inference",
  );
  assert.equal(
    await builder.generateCommitMessage("feature/local", "+ changes", {
      model: "one-off",
    }),
    "feat: local inference",
  );
  assert.deepEqual(
    server.requests.map((r) => [r.path, r.authorization, r.body.model]),
    [
      ["/v1/chat/completions", undefined, "saved-local"],
      ["/v1/chat/completions", undefined, "one-off"],
    ],
  );
  assert.match(JSON.stringify(server.requests[0].body.messages), /Be concise/);
  assert.doesNotMatch(JSON.stringify(server.requests), /secret/);
});

test("custom authentication accepts short server-defined keys and can be cleared", async (t) => {
  const server = await endpoint(t);
  config.setCustomBaseURL(server.baseURL);
  config.setModel("custom", "local");
  config.setKey("custom", "abc");
  const builder = new AIBuilder("custom", "");
  await builder.generateCommitMessage("main", "diff");
  config.clearKey("custom");
  await builder.generateCommitMessage("main", "diff");
  assert.deepEqual(
    server.requests.map((r) => r.authorization),
    ["Bearer abc", undefined],
  );
});

test("missing custom model and blank overrides return setup errors before requesting", async (t) => {
  const server = await endpoint(t);
  config.setCustomBaseURL(server.baseURL);
  const builder = new AIBuilder("custom", "");
  const missing = await builder.generateCommitMessage("main", "diff");
  assert.ok(typeof missing === "object");
  assert.match(missing.error, /--model/);
  const blank = await builder.generateCommitMessage("main", "diff", {
    model: " ",
  });
  assert.ok(typeof blank === "object");
  assert.match(blank.error, /non-empty/);
  assert.equal(server.requests.length, 0);
});

for (const baseURL of [
  "",
  "ftp://localhost/v1",
  "http://localhost:1234/v1/chat/completions",
  "http://localhost:1234/v1/chat/completions//",
  "http://localhost:1234/v1/responses////",
]) {
  test(`invalid saved custom URL returns setup guidance before networking: ${baseURL || "missing"}`, async (t) => {
    config.setModel("custom", "local-model");
    config.setKey("custom", "saved-secret");
    // Existing or externally edited stores can contain values the setter rejects.
    t.mock.method(config, "getCustomBaseURL", () => baseURL);
    const fetch = t.mock.method(globalThis, "fetch", async () =>
      assert.fail("must validate the endpoint before a request"),
    );
    const result = await new AIBuilder("custom", "").generateCommitMessage(
      "main",
      "diff",
    );
    assert.ok(typeof result === "object");
    assert.match(
      result.error,
      /custom.*gsmart config --provider custom --base-url <url> --model <model>/,
    );
    assert.doesNotMatch(result.error, /saved-secret/);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test("custom generation failures give endpoint guidance without exposing raw error secrets", async () => {
  config.setCustomBaseURL("http://localhost:1234/v1");
  config.setModel("custom", "local-model");
  let calls = 0;
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    ai: {
      generateText: async () => {
        calls++;
        throw new Error("Failed to generate with key saved-secret");
      },
    },
  });
  const result = await new MockAI("custom", "").generateCommitMessage(
    "main",
    "diff",
    {
      onRetry: () =>
        assert.fail("an unclassified generation failure must not retry"),
    },
  );
  assert.match(
    result.error,
    /custom - Generation failed.*local-model.*--base-url/,
  );
  assert.doesNotMatch(result.error, /saved-secret/);
  assert.equal(calls, 1);
});

for (const [status, message, expected] of [
  [404, "model missing", /--model.*base-url/],
  [400, "model not supported", /Model is not available/],
  [422, "unsupported model", /Model is not available/],
  [400, "invalid request format", /API request failed \(HTTP 400\)/],
  [405, "method not allowed", /Chat Completions/],
  [401, "unauthorized", /--api-key.*--clear-api-key/],
  [403, "forbidden", /authentication/],
  [500, "server failed", /HTTP 500/],
] as const) {
  test(`custom HTTP ${status} returns actionable diagnostics without response secrets`, async (t) => {
    const server = await endpoint(t, status, {
      error: { message: `${message}: private-secret`, type: "api_error" },
    });
    config.setCustomBaseURL(server.baseURL);
    config.setModel("custom", "local-model");
    const result = await new AIBuilder("custom", "").generateCommitMessage(
      "main",
      "diff",
      { maxRetries: 1 },
    );
    assert.ok(typeof result === "object");
    assert.match(result.error, expected);
    assert.match(result.error, /127\.0\.0\.1/);
    assert.doesNotMatch(result.error, /private-secret/);
    assert.equal(server.requests.length, 1, "SDK must not add hidden retries");
  });
}

test("unreachable local endpoint explains how to check server and URL", async (t) => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  t.after(() => server.close());
  config.setCustomBaseURL(`http://127.0.0.1:${address.port}/v1`);
  const result = await new AIBuilder("custom", "").generateCommitMessage(
    "main",
    "diff",
    { model: "local", maxRetries: 1 },
  );
  assert.ok(typeof result === "object");
  assert.match(result.error, /Could not reach.*server is running.*--base-url/);
});

test("custom endpoint with incompatible response reports the API requirement", async (t) => {
  const server = await endpoint(t, 200, { response: "native Ollama response" });
  config.setCustomBaseURL(server.baseURL);
  const result = await new AIBuilder("custom", "").generateCommitMessage(
    "main",
    "diff",
    { model: "local", maxRetries: 1 },
  );
  assert.ok(typeof result === "object");
  assert.match(result.error, /Unexpected response.*Chat Completions/);
});

test("hosted API-key and compatible hosted models use explicit API operations", async () => {
  const requests: {
    url: string;
    authorization: string | null;
    body: Record<string, unknown>;
  }[] = [];
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    "@ai-sdk/openai": {
      createOpenAI: (options: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI({
          ...options,
          fetch: async (url, init) => {
            requests.push({
              url: String(url),
              authorization: new Headers(init?.headers).get("authorization"),
              body: JSON.parse(String(init?.body)),
            });
            return Response.json(
              String(url).endsWith("/responses")
                ? responsesResponse
                : chatResponse,
            );
          },
        }),
    },
  });
  for (const provider of ["openai", "fireworks", "plataformia"] as const) {
    config.setKey(provider, "sk-hosted-key-123456");
    config.setModel(provider, `${provider}-saved`);
    const result = await new MockAI(provider, "").generateCommitMessage(
      "main",
      "diff",
    );
    assert.equal(typeof result, "string", JSON.stringify(result));
  }
  assert.deepEqual(
    requests.map((r) => r.url),
    [
      "https://api.openai.com/v1/responses",
      "https://api.fireworks.ai/inference/v1/chat/completions",
      "https://apigateway.avangenio.net/chat/completions",
    ],
  );
  assert.deepEqual(
    requests.map((r) => r.body.model),
    ["openai-saved", "fireworks-saved", "plataformia-saved"],
  );
  assert.ok(
    requests.every((r) => r.authorization === "Bearer sk-hosted-key-123456"),
  );
});

test("OAuth uses Codex streaming Responses with instructions, store:false, refreshed tokens and model overrides", async () => {
  const requests: {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  let refreshes = 0;
  config.setOpenAIOAuthTokens({
    accessToken: "old",
    refreshToken: "refresh",
    idToken: "id",
    accountId: "account-id",
  });
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    "../src/utils/openai-oauth.ts": {
      ensureFreshOpenAIOAuthTokens: async (
        tokens: Record<string, unknown>,
        persist: (tokens: unknown) => void,
      ) => {
        refreshes++;
        const refreshed = { ...tokens, accessToken: "fresh-access" };
        persist(refreshed);
        return refreshed;
      },
    },
    "@ai-sdk/openai": {
      createOpenAI: (options: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI({
          ...options,
          fetch: async (url, init) => {
            requests.push({
              url: String(url),
              headers: new Headers(init?.headers),
              body: JSON.parse(String(init?.body)),
            });
            const events = [
              {
                type: "response.created",
                response: {
                  ...responsesResponse,
                  output: [],
                  status: "in_progress",
                },
              },
              {
                type: "response.output_item.added",
                output_index: 0,
                item: {
                  id: "msg_test",
                  type: "message",
                  role: "assistant",
                  content: [],
                  status: "in_progress",
                },
              },
              {
                type: "response.output_text.delta",
                item_id: "msg_test",
                output_index: 0,
                content_index: 0,
                delta: "feat: oauth inference",
              },
              {
                type: "response.output_text.done",
                item_id: "msg_test",
                output_index: 0,
                content_index: 0,
                text: "feat: oauth inference",
              },
              {
                type: "response.output_item.done",
                output_index: 0,
                item: responsesResponse.output[0],
              },
              { type: "response.completed", response: responsesResponse },
            ];
            return new Response(
              events
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(""),
              { headers: { "content-type": "text/event-stream" } },
            );
          },
        }),
    },
  });
  const builder = new MockAI("openai", "Custom style");
  assert.equal(
    await builder.generateCommitMessage("main", "diff"),
    "feat: oauth inference",
  );
  config.setModel("openai", "saved-codex");
  await builder.generateCommitMessage("main", "diff");
  await builder.generateCommitMessage("main", "diff", {
    model: "explicit-codex",
  });
  assert.equal(refreshes, 3);
  assert.deepEqual(
    requests.map((r) => r.body.model),
    ["gpt-5-codex", "saved-codex", "explicit-codex"],
  );
  for (const request of requests) {
    assert.equal(
      request.url,
      "https://chatgpt.com/backend-api/codex/responses",
    );
    assert.equal(request.headers.get("authorization"), "Bearer fresh-access");
    assert.equal(request.headers.get("chatgpt-account-id"), "account-id");
    assert.equal(request.headers.get("originator"), "gsmart_cli");
    assert.equal(request.body.store, false);
    assert.equal(request.body.stream, true);
    assert.match(String(request.body.instructions), /commit/);
    assert.match(JSON.stringify(request.body.input), /Custom style/);
  }
  assert.equal(config.getOpenAIOAuthTokens()?.accessToken, "fresh-access");
});

test("OAuth stream failures discard partial output, retry transient errors, and diagnose model access", async () => {
  config.setOpenAIOAuthTokens({
    accessToken: "access",
    refreshToken: "refresh",
    idToken: "id",
    expiresAt: Date.now() + 3_600_000,
  });
  let status = 500;
  let calls = 0;
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    ai: {
      streamText: () => ({
        fullStream: (async function* () {
          calls++;
          if (calls === 2 && status === 500) {
            yield { type: "text-delta", text: "feat: recovered" };
            yield { type: "raw", rawValue: { type: "response.completed" } };
            yield { type: "finish", finishReason: "stop" };
          } else {
            yield { type: "text-delta", text: "partial must be discarded" };
            yield {
              type: "error",
              error: new APICallError({
                statusCode: status,
                message: "model not supported",
                url: "https://chatgpt.com/backend-api/codex/responses",
                requestBodyValues: {},
              }),
            };
          }
        })(),
      }),
    },
  });
  const builder = new MockAI("openai", "");
  const delays: number[] = [];
  const result = await builder.generateCommitMessage("main", "diff", {
    delayFn: async (ms: number) => {
      delays.push(ms);
    },
  });
  assert.equal(result, "feat: recovered");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
  for (const [code, hint] of [
    [401, /ChatGPT authorization.*gsmart login/],
    [400, /model.*supported by your ChatGPT subscription/],
  ] as const) {
    status = code;
    calls = 0;
    const failure = await builder.generateCommitMessage("main", "diff");
    assert.match(failure.error, hint);
    assert.equal(calls, 1);
    assert.doesNotMatch(failure.error, /partial must/);
  }
});

test("canceling OAuth streaming returns cancellation without a retry or partial result", async () => {
  config.setOpenAIOAuthTokens({
    accessToken: "access",
    refreshToken: "refresh",
    idToken: "id",
    expiresAt: Date.now() + 3_600_000,
  });
  const controller = new AbortController();
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    ai: {
      streamText: () => ({
        fullStream: (async function* () {
          yield { type: "text-delta", text: "partial" };
          controller.abort();
        })(),
      }),
    },
  });
  const result = await new MockAI("openai", "").generateCommitMessage(
    "main",
    "diff",
    {
      abortSignal: controller.signal,
      onRetry: () => assert.fail("Cancelled requests must not retry"),
    },
  );
  assert.deepEqual(result, { error: "Generation canceled." });
});

function partialOAuthEvents(text = "feat: incomplete") {
  return [
    {
      type: "response.created",
      response: { ...responsesResponse, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        status: "in_progress",
      },
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_test",
      output_index: 0,
      content_index: 0,
      delta: text,
    },
  ];
}

const encodeEvents = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

function completedOAuthEvents(text: string) {
  const item = {
    ...responsesResponse.output[0],
    content: [{ type: "output_text", text, annotations: [] }],
  };
  return [
    ...partialOAuthEvents(text),
    {
      type: "response.output_text.done",
      item_id: "msg_test",
      output_index: 0,
      content_index: 0,
      text,
    },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: { ...responsesResponse, output: [item] },
    },
  ];
}

async function oauthBuilder(fetch: typeof globalThis.fetch) {
  config.setOpenAIOAuthTokens({
    accessToken: "access",
    refreshToken: "refresh",
    idToken: "id",
    expiresAt: Date.now() + 3_600_000,
  });
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    "@ai-sdk/openai": {
      createOpenAI: (options: Parameters<typeof createOpenAI>[0]) =>
        createOpenAI({ ...options, fetch }),
    },
  });
  return new MockAI("openai", "");
}

function streamingResponse(events: unknown[]) {
  return new Response(encodeEvents(events), {
    headers: { "content-type": "text/event-stream" },
  });
}

function stalledOAuthResponse(signal: AbortSignal) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(encodeEvents(partialOAuthEvents())),
        );
        const abort = () => controller.error(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("OAuth transport failures after HTTP 200 exhaust retries and never return partial text", async () => {
  let calls = 0;
  const builder = await oauthBuilder(async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(encodeEvents(partialOAuthEvents())),
          );
          setImmediate(() =>
            controller.error(
              new TypeError("terminated", {
                cause: Object.assign(new Error("other side closed"), {
                  code: "UND_ERR_SOCKET",
                }),
              }),
            ),
          );
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const retries: number[] = [];
  const delays: number[] = [];
  const result = await builder.generateCommitMessage("main", "diff", {
    maxRetries: 2,
    onRetry: (attempt: number) => retries.push(attempt),
    delayFn: async (ms: number) => {
      delays.push(ms);
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(retries, [1]);
  assert.deepEqual(delays, [1000]);
  assert.match(result.error, /Response stream was interrupted/);
  assert.doesNotMatch(result.error, /feat: incomplete/);
});

test("OAuth refuses a completed stream whose SDK finish reason is not stop", async () => {
  config.setOpenAIOAuthTokens({
    accessToken: "access",
    refreshToken: "refresh",
    idToken: "id",
    expiresAt: Date.now() + 3_600_000,
  });
  let calls = 0;
  const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
    ai: {
      streamText: () => ({
        fullStream: (async function* () {
          calls++;
          yield { type: "text-delta", text: "feat: incomplete" };
          yield { type: "raw", rawValue: { type: "response.completed" } };
          yield { type: "finish", finishReason: "tool-calls" };
        })(),
      }),
    },
  });
  const result = await new MockAI("openai", "").generateCommitMessage(
    "main",
    "diff",
    {
      onRetry: () =>
        assert.fail("unsuccessful completion must not retry unchanged"),
    },
  );
  assert.match(result.error, /Response did not complete successfully/);
  assert.doesNotMatch(result.error, /feat: incomplete/);
  assert.equal(calls, 1);
});

for (const interruption of ["timeout", "eof", "disconnect"] as const) {
  test(`real OAuth SDK recovers from ${interruption} without concatenating partial text`, async (t) => {
    const previous = process.env.GSMART_TIMEOUT;
    process.env.GSMART_TIMEOUT = "250";
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => {
      clearInterval(keepAlive);
      if (previous === undefined) delete process.env.GSMART_TIMEOUT;
      else process.env.GSMART_TIMEOUT = previous;
    });
    let calls = 0;
    const builder = await oauthBuilder(async (_url, init) => {
      calls++;
      if (calls > 1) {
        return streamingResponse(completedOAuthEvents("fix: fully recovered"));
      }
      if (interruption === "eof") {
        return streamingResponse(partialOAuthEvents());
      }
      assert.ok(init?.signal);
      if (interruption === "timeout") {
        return stalledOAuthResponse(init.signal);
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(encodeEvents(partialOAuthEvents())),
            );
            // Match Node fetch when the socket closes during the response body.
            setImmediate(() =>
              controller.error(
                new TypeError("terminated", {
                  cause: Object.assign(new Error("other side closed"), {
                    code: "UND_ERR_SOCKET",
                  }),
                }),
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const retries: number[] = [];
    const delays: number[] = [];
    const result = await builder.generateCommitMessage("main", "diff", {
      maxRetries: 2,
      onRetry: (attempt: number) => retries.push(attempt),
      delayFn: async (ms: number) => {
        delays.push(ms);
      },
    });
    assert.equal(result, "fix: fully recovered");
    assert.equal(calls, 2);
    assert.deepEqual(retries, [1]);
    assert.deepEqual(delays, [1000]);
  });
}

for (const reason of ["max_output_tokens", "content_filter", undefined]) {
  test(`real OAuth SDK rejects incomplete response (${reason ?? "no reason"}) without retrying`, async () => {
    let calls = 0;
    const builder = await oauthBuilder(async () => {
      calls++;
      return streamingResponse([
        ...partialOAuthEvents(),
        {
          type: "response.incomplete",
          response: {
            ...responsesResponse,
            status: "incomplete",
            ...(reason ? { incomplete_details: { reason } } : {}),
          },
        },
      ]);
    });
    const result = await builder.generateCommitMessage("main", "diff", {
      maxRetries: 2,
      onRetry: () =>
        assert.fail("An incomplete response must not retry unchanged"),
      delayFn: async () => assert.fail("Unexpected retry delay"),
    });
    assert.equal(typeof result, "object", JSON.stringify(result));
    assert.match(result.error, /incomplete/i);
    assert.doesNotMatch(result.error, /feat: incomplete/);
    assert.equal(calls, 1);
  });
}

for (const reason of [undefined, new Error("Stop generation"), "cancel"]) {
  test(`real OAuth SDK preserves explicit cancellation (${String(reason)}) during streaming`, async () => {
    const controller = new AbortController();
    let calls = 0;
    const builder = await oauthBuilder(async (_url, init) => {
      calls++;
      assert.ok(init?.signal);
      const response = stalledOAuthResponse(init.signal);
      setImmediate(() => controller.abort(reason));
      return response;
    });
    const result = await builder.generateCommitMessage("main", "diff", {
      abortSignal: controller.signal,
      maxRetries: 2,
      onRetry: () => assert.fail("Canceled requests must not retry"),
      delayFn: async () => assert.fail("Unexpected retry delay"),
    });
    assert.deepEqual(result, { error: "Generation canceled." });
    assert.equal(calls, 1);
  });
}

test("real OAuth SDK cancellation during interruption backoff prevents a second request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const builder = await oauthBuilder(async () => {
    calls++;
    return streamingResponse(partialOAuthEvents());
  });
  const result = await builder.generateCommitMessage("main", "diff", {
    abortSignal: controller.signal,
    maxRetries: 2,
    onRetry: () => controller.abort(),
  });
  assert.deepEqual(result, { error: "Generation canceled." });
  assert.equal(calls, 1);
});

test("real OAuth SDK rejects a completed response with no commit message", async () => {
  const builder = await oauthBuilder(async () =>
    streamingResponse(completedOAuthEvents("")),
  );
  const result = await builder.generateCommitMessage("main", "diff", {
    onRetry: () => assert.fail("Empty output must not retry unchanged"),
  });
  assert.equal(typeof result, "object", JSON.stringify(result));
  assert.match(result.error, /response/i);
});

for (const partial of [false, true]) {
  test(`real OAuth SDK timeout ${partial ? "after" : "before"} text retries and rejects incomplete output`, async (t) => {
    config.setOpenAIOAuthTokens({
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "id",
      expiresAt: Date.now() + 3_600_000,
    });
    const previous = process.env.GSMART_TIMEOUT;
    process.env.GSMART_TIMEOUT = "250";
    // AbortSignal.timeout does not keep the process alive on its own.
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => {
      clearInterval(keepAlive);
      if (previous === undefined) delete process.env.GSMART_TIMEOUT;
      else process.env.GSMART_TIMEOUT = previous;
    });
    let calls = 0;
    const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
      "@ai-sdk/openai": {
        createOpenAI: (options: Parameters<typeof createOpenAI>[0]) =>
          createOpenAI({
            ...options,
            fetch: async (_url, init) => {
              calls++;
              const signal = init?.signal;
              assert.ok(signal);
              return new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(
                      new TextEncoder().encode(
                        encodeEvents(
                          partial
                            ? partialOAuthEvents()
                            : partialOAuthEvents().slice(0, 1),
                        ),
                      ),
                    );
                    const abort = () => controller.error(signal.reason);
                    if (signal.aborted) abort();
                    else
                      signal.addEventListener("abort", abort, { once: true });
                  },
                }),
                { headers: { "content-type": "text/event-stream" } },
              );
            },
          }),
      },
    });
    const retries: number[] = [];
    const result = await new MockAI("openai", "").generateCommitMessage(
      "main",
      "diff",
      {
        maxRetries: 2,
        delayFn: async () => {},
        onRetry: (attempt: number) => retries.push(attempt),
      },
    );
    assert.equal(typeof result, "object", JSON.stringify(result));
    assert.match(result.error, /timed out/i);
    assert.equal(calls, 2);
    assert.deepEqual(retries, [1]);
    assert.doesNotMatch(result.error, /feat: incomplete/);
  });
}

for (const ending of ["eof", "incomplete"] as const) {
  test(`real OAuth SDK rejects partial output on ${ending}`, async () => {
    config.setOpenAIOAuthTokens({
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "id",
      expiresAt: Date.now() + 3_600_000,
    });
    const events: unknown[] = partialOAuthEvents();
    if (ending === "incomplete") {
      events.push({
        type: "response.incomplete",
        response: {
          ...responsesResponse,
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        },
      });
    }
    const { AIBuilder: MockAI } = await esmock("../src/utils/ai.ts", {
      "@ai-sdk/openai": {
        createOpenAI: (options: Parameters<typeof createOpenAI>[0]) =>
          createOpenAI({
            ...options,
            fetch: async () =>
              new Response(encodeEvents(events), {
                headers: { "content-type": "text/event-stream" },
              }),
          }),
      },
    });
    const result = await new MockAI("openai", "").generateCommitMessage(
      "main",
      "diff",
      { maxRetries: 1 },
    );
    assert.equal(typeof result, "object", JSON.stringify(result));
    assert.match(result.error, /stream|response/i);
    assert.doesNotMatch(result.error, /feat: incomplete/);
  });
}

test("CLI saves and inspects local settings, generates with keyless server, and honors --model", async (t) => {
  const server = await endpoint(t);
  const root = repository(t);
  writeFileSync(join(root, "example.txt"), "local change");
  git(root, "add", "example.txt");
  const directory = mkdtempSync(join(tmpdir(), "gsmart-endpoint-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry =
    process.env.GSMART_TEST_CLI_ENTRY ??
    fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const run = (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        ...(entry.endsWith(".ts")
          ? ["--import", import.meta.resolve("tsx")]
          : []),
        entry,
        ...args,
      ],
      {
        cwd: root,
        timeout: 20_000,
        env: {
          ...process.env,
          GSMART_CONFIG_DIR: directory,
          NO_UPDATE_NOTIFIER: "1",
          FORCE_COLOR: "0",
        },
      },
    );
  await run([
    "config",
    "--provider",
    "custom",
    "--base-url",
    server.baseURL,
    "--model",
    "saved-local",
    "--default-provider",
    "custom",
  ]);
  const shown = await run(["config", "--show"]);
  assert.match(shown.stdout, /Default provider: custom/);
  assert.match(shown.stdout, /model=saved-local/);
  for (const prefix of [[], ["generate"]]) {
    const generated = await run([
      ...prefix,
      "--dry-run",
      "--yes",
      "--model",
      "one-off",
    ]);
    assert.match(generated.stdout, /feat: local inference/);
  }
  assert.deepEqual(
    server.requests.map((r) => [r.path, r.body.model, r.authorization]),
    [
      ["/v1/chat/completions", "one-off", undefined],
      ["/v1/chat/completions", "one-off", undefined],
    ],
  );
  assert.match(git(root, "diff", "--cached", "--name-only"), /example.txt/);

  writeFileSync(
    join(root, "large.ts"),
    Array.from(
      { length: 1000 },
      (_, i) => `export const value${i} = "updated behavior";\n`,
    ).join(""),
  );
  git(root, "add", "large.ts");
  const originalIndex = git(root, "write-tree");
  const generated = await run([
    "--dry-run",
    "--show-context",
    "--context-budget",
    "8192",
    "--context-exclude",
    "example.txt",
  ]);
  assert.match(generated.stdout, /"budgetTokens": 8192/);
  assert.match(generated.stdout, /"treatment": "condensed"/);
  assert.match(generated.stdout, /"treatment": "excluded"/);
  assert.equal(
    server.requests.length,
    3,
    "default reduction must not request AI summaries",
  );
  assert.doesNotMatch(
    JSON.stringify(server.requests[2].body.messages),
    /example.txt/,
  );

  writeFileSync(
    join(root, ".gsmartrc.json"),
    JSON.stringify({ context: { summarize: true, maxSummaryRequests: 1 } }),
  );
  await run(["--dry-run", "--no-summarize"]);
  assert.equal(
    server.requests.length,
    4,
    "--no-summarize must override repository opt-in",
  );
  await run(["--dry-run", "--summarize"]);
  assert.equal(
    server.requests.length,
    6,
    "opt-in makes a capped summary call then the final request",
  );
  assert.equal(git(root, "write-tree"), originalIndex);
  for (const request of server.requests) {
    const messages = request.body.messages as { content: string }[];
    assert.ok(
      messages.reduce(
        (total, message) => total + estimateTokens(message.content),
        0,
      ) +
        Number(request.body.max_tokens) +
        REQUEST_OVERHEAD <=
        8192,
    );
  }
});

test("OAuth summary and final requests preserve streaming options and budget all instructions", async () => {
  const requests: Record<string, unknown>[] = [];
  const builder = await oauthBuilder(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return streamingResponse(
      completedOAuthEvents(
        body.instructions.startsWith("Summarize")
          ? "Handlers now retry fetches."
          : "fix(api): retry requests",
      ),
    );
  });
  const { conventions } = resolveConventions([
    {
      source: "test",
      settings: {
        context: { summarize: true, maxSummaryRequests: 1, budgetTokens: 8192 },
      },
    },
  ]);
  assert.equal(
    await builder.generateCommitMessage("main", sourceDiff(), { conventions }),
    "fix(api): retry requests",
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.store, false);
    assert.equal(request.stream, true);
    assert.equal(request.max_output_tokens, 1024);
    const input = request.input as { content: { text: string }[] }[];
    const text = input
      .flatMap((message) => message.content.map((part) => part.text))
      .join("");
    assert.ok(
      estimateTokens(String(request.instructions)) +
        estimateTokens(text) +
        1024 +
        REQUEST_OVERHEAD <=
        8192,
    );
  }
});
