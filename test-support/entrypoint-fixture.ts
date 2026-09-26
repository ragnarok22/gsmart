import "./setup-env";
import esmock from "esmock";
import { register } from "node:module";
import commands from "../src/gsmart.ts";
import {
  dispatchInterrupt,
  withInterruptHandler,
} from "../src/utils/interrupt.ts";
import {
  WorkflowError,
  workflowFailure,
  writeWorkflowResult,
} from "../src/utils/workflow-result.ts";

export type Scenario = {
  earlySignal?: boolean;
  startupFailure?: "error" | "value";
  action?: "error" | "value" | "workflow" | "signal";
};

const [scenarioJSON, ...args] = process.argv.slice(2);
const scenario = JSON.parse(scenarioJSON) as Scenario;
process.argv = [process.execPath, "gsmart", ...args];

function report(event: string): void {
  process.send?.(event);
}

async function fail(phase: "startup" | "action", kind: "error" | "value") {
  await Promise.resolve();
  report(`${phase}:failed`);
  const message = `${phase} failed asynchronously`;
  throw kind === "error" ? new Error(message) : message;
}

async function interruptibleAction(options: Record<string, unknown>) {
  let cancel!: (signal: NodeJS.Signals) => void;
  const canceled = new Promise<NodeJS.Signals>((resolve) => {
    cancel = resolve;
  });
  // A pending promise alone does not keep Node alive. The IPC channel represents
  // an active request/prompt, and is released only after explicit cleanup.
  process.channel?.ref();
  const signal = await withInterruptHandler(cancel, async () => {
    report("action:waiting");
    const signal = await canceled;
    report(`action:canceled:${signal}`);
    await new Promise<void>((resolve) => {
      process.once("message", (message) => {
        if (message !== "cleanup") throw new Error("Expected cleanup release");
        resolve();
      });
      report("cleanup:waiting");
    });
    // Confirm cleanup was observed before SIGTERM's real deferred process.exit.
    await new Promise<void>((resolve, reject) => {
      process.send?.("cleanup:done", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return signal;
  });
  process.channel?.unref();
  if (options.output === "json") {
    writeWorkflowResult(
      workflowFailure("CANCELED", `Generation canceled by ${signal}.`),
      "json",
    );
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  } else {
    report("review:resumed");
  }
}

// This is evaluated by the replacement lazy module, after index.ts has installed
// its real signal handlers. The parent waits for IPC readiness before signaling.
export async function loadCommands() {
  report("import:started");
  if (scenario.earlySignal) {
    process.channel?.ref();
    const signal = await new Promise<NodeJS.Signals>((resolve) => {
      process.once("SIGINT", () => resolve("SIGINT"));
      process.once("SIGTERM", () => resolve("SIGTERM"));
      report("import:waiting");
    });
    report(`import:interrupted:${signal}`);
    process.channel?.unref();
  }
  if (scenario.startupFailure) await fail("startup", scenario.startupFailure);
  report("import:loaded");
  return commands.map((command) => ({
    ...command,
    action: async (options: Record<string, unknown>) => {
      report("action:started");
      if (scenario.action === "signal") await interruptibleAction(options);
      else if (scenario.action === "workflow")
        throw new WorkflowError("GENERATION", "Provider rejected generation");
      else if (scenario.action) await fail("action", scenario.action);
      report("action:done");
    },
  }));
}

const moduleURL = (source: string) =>
  `data:text/javascript,${encodeURIComponent(source)}`;
const lazyCommandsURL = moduleURL(`
  import { loadCommands } from ${JSON.stringify(import.meta.url)};
  export default await loadCommands();
`);
const metadataURL = moduleURL(
  `export default ${JSON.stringify({
    name: "gsmart",
    version: "1.2.3",
    description: "Entrypoint test fixture",
  })};`,
);

// Redirect only the entrypoint's imports, leaving the real Commander program and
// interrupt implementation intact. The deferred module rejects/blocks at the
// actual import boundary; no timers or mocked parseAsync are involved.
register(
  moduleURL(`
    export function resolve(specifier, context, nextResolve) {
      if (context.parentURL?.split("?")[0] === ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)}) {
        const url = ["./gsmart", "./gsmart.ts"].includes(specifier) ? ${JSON.stringify(lazyCommandsURL)}
          : ["./build-info", "./build-info.ts"].includes(specifier) ? ${JSON.stringify(metadataURL)} : undefined;
        if (url) return { url, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `),
  import.meta.url,
);

function notice(name: string) {
  report(name);
  console.log(name);
}

// main() outlives index.ts module evaluation; retain its dynamic import mocks for
// this isolated process, including on Node 22 where eager purging races imports.
await esmock.p("../src/index.ts", {
  "../src/utils/interrupt.ts": { dispatchInterrupt },
  "../src/utils/version-check.ts": { checkForUpdates: () => notice("update") },
  "../src/utils/welcome.ts": { showWelcomeOnce: () => notice("welcome") },
  "../src/utils/holiday.ts": { showHolidayMessage: () => notice("holiday") },
});
