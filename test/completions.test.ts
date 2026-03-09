import "../test-support/setup-env";

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
} from "../src/commands/completions";

const COMMANDS = ["generate", "login", "reset", "completions"];
const PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "fireworks",
  "plataformia",
];
const GENERATE_FLAGS = ["-p", "--prompt", "-P", "--provider", "-y", "--yes"];
const RESET_FLAGS = ["-f", "--force"];
const FISH_GENERATE_FLAGS = [
  "-s p",
  "-l prompt",
  "-s P",
  "-l provider",
  "-s y",
  "-l yes",
];
const FISH_RESET_FLAGS = ["-s f", "-l force"];

describe("bash completion", () => {
  it("includes shell-specific marker", () => {
    const script = generateBashCompletion();
    assert.ok(script.includes("complete -F _gsmart_completions gsmart"));
  });

  it("includes all commands", () => {
    const script = generateBashCompletion();
    for (const cmd of COMMANDS) {
      assert.ok(script.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("includes all provider values", () => {
    const script = generateBashCompletion();
    for (const provider of PROVIDERS) {
      assert.ok(script.includes(provider), `Missing provider: ${provider}`);
    }
  });

  it("includes generate flags", () => {
    const script = generateBashCompletion();
    for (const flag of GENERATE_FLAGS) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });

  it("includes reset flags", () => {
    const script = generateBashCompletion();
    for (const flag of RESET_FLAGS) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });
});

describe("zsh completion", () => {
  it("includes shell-specific marker", () => {
    const script = generateZshCompletion();
    assert.ok(script.includes("#compdef gsmart"));
  });

  it("includes all commands", () => {
    const script = generateZshCompletion();
    for (const cmd of COMMANDS) {
      assert.ok(script.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("includes all provider values", () => {
    const script = generateZshCompletion();
    for (const provider of PROVIDERS) {
      assert.ok(script.includes(provider), `Missing provider: ${provider}`);
    }
  });

  it("includes generate flags", () => {
    const script = generateZshCompletion();
    for (const flag of GENERATE_FLAGS) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });

  it("includes reset flags", () => {
    const script = generateZshCompletion();
    for (const flag of RESET_FLAGS) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });
});

describe("fish completion", () => {
  it("includes shell-specific marker", () => {
    const script = generateFishCompletion();
    assert.ok(script.includes("complete -c gsmart"));
  });

  it("includes all commands", () => {
    const script = generateFishCompletion();
    for (const cmd of COMMANDS) {
      assert.ok(script.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("includes all provider values", () => {
    const script = generateFishCompletion();
    for (const provider of PROVIDERS) {
      assert.ok(script.includes(provider), `Missing provider: ${provider}`);
    }
  });

  it("includes generate flags", () => {
    const script = generateFishCompletion();
    for (const flag of FISH_GENERATE_FLAGS) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });

  it("includes reset flags", () => {
    const script = generateFishCompletion();
    for (const flag of FISH_RESET_FLAGS) {
      assert.ok(script.includes(flag), `Missing flag: ${flag}`);
    }
  });
});
