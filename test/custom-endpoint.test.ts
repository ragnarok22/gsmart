import test from "node:test";
import assert from "node:assert/strict";
import { configureCustomEndpoint } from "../src/utils/custom-endpoint.ts";

const createStore = () => {
  const initial = {
    baseURL: "http://localhost:11434/v1",
    model: "saved-model",
    key: "saved-test-key",
  };
  const state = { ...initial };
  const reads: string[] = [];
  const writes: string[][] = [];
  const store: Parameters<typeof configureCustomEndpoint>[1] = {
    getCustomBaseURL: () => {
      reads.push("baseURL");
      return state.baseURL;
    },
    getModel: (provider) => {
      reads.push(`model:${provider}`);
      return state.model;
    },
    setCustomBaseURL: (baseURL) => {
      writes.push(["setCustomBaseURL", baseURL]);
      state.baseURL = baseURL;
    },
    setModel: (provider, model) => {
      writes.push(["setModel", provider, model]);
      state.model = model;
    },
    setKey: (provider, key) => {
      writes.push(["setKey", provider, key]);
      state.key = key;
    },
    clearKey: (provider) => {
      writes.push(["clearKey", provider]);
      state.key = "";
    },
  };
  return { store, initial, state, reads, writes };
};

for (const cancelledPrompt of ["baseURL", "model"]) {
  test(`cancelling custom ${cancelledPrompt} setup preserves settings and stops prompting`, async () => {
    const { store, initial, state, reads, writes } = createStore();
    const questions: string[] = [];
    const saved = await configureCustomEndpoint(async (question) => {
      assert.ok(!Array.isArray(question));
      questions.push(String(question.name));
      if (question.name === cancelledPrompt) return {};
      return {
        baseURL: "http://localhost:1234/v1",
        model: "replacement-model",
        key: "replacement-test-key",
      };
    }, store);

    assert.equal(saved, false);
    assert.deepEqual(
      questions,
      cancelledPrompt === "baseURL" ? ["baseURL"] : ["baseURL", "model"],
    );
    assert.deepEqual(
      reads,
      cancelledPrompt === "baseURL" ? ["baseURL"] : ["baseURL", "model:custom"],
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(state, initial);
  });
}

for (const { name, key, expectedKey } of [
  {
    name: "replaces authentication with a trimmed nonblank key",
    key: " \t replacement-test-key \n",
    expectedKey: "replacement-test-key",
  },
  {
    name: "clears existing authentication for whitespace-only input",
    key: " \t \n",
    expectedKey: "",
  },
]) {
  test(`custom setup ${name} only after all prompts complete`, async () => {
    const { store, initial, state, writes } = createStore();
    const questions: string[] = [];
    const saved = await configureCustomEndpoint(async (question) => {
      assert.ok(!Array.isArray(question));
      questions.push(String(question.name));
      assert.deepEqual(writes, [], "do not save a partially completed setup");
      assert.deepEqual(state, initial);
      if (question.name === "baseURL") {
        assert.equal(question.initial, initial.baseURL);
        return { baseURL: " http://localhost:1234/v1/ " };
      }
      if (question.name === "model") {
        assert.equal(question.initial, initial.model);
        return { model: " replacement-model " };
      }
      assert.equal(question.name, "key");
      assert.equal(question.type, "password");
      assert.equal(question.initial, undefined, "do not prefill a saved key");
      return { key };
    }, store);

    assert.equal(saved, true);
    assert.deepEqual(questions, ["baseURL", "model", "key"]);
    assert.deepEqual(state, {
      baseURL: "http://localhost:1234/v1",
      model: "replacement-model",
      key: expectedKey,
    });
    assert.deepEqual(writes, [
      ["setCustomBaseURL", state.baseURL],
      ["setModel", "custom", state.model],
      expectedKey ? ["setKey", "custom", expectedKey] : ["clearKey", "custom"],
    ]);
  });
}
