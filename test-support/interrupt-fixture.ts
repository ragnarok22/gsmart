import "./setup-env";
import esmock from "esmock";
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { createMessageEditor, runEditor } from "../src/utils/editor.ts";
import {
  dispatchInterrupt,
  withInterruptHandler,
} from "../src/utils/interrupt.ts";

// Load the real CLI signal registrations without its startup UI or commands.
class Command {
  name() {
    return this;
  }
  version() {
    return this;
  }
  description() {
    return this;
  }
  option() {
    return this;
  }
  hook() {
    return this;
  }
  parse() {
    return this;
  }
}

// Supply generated metadata in memory, before any filesystem resolution.
// esmock's relative virtual mocks produce a responseURL rejected by Node.
const buildInfoModule = `data:text/javascript,${encodeURIComponent(
  `export default ${JSON.stringify({
    name: "gsmart",
    version: "0.0.0-test",
    description: "Interrupt test fixture",
  })};`,
)}`;
register(
  `data:text/javascript,${encodeURIComponent(`
    export function resolve(specifier, context, nextResolve) {
      if (specifier === "./build-info" &&
          context.parentURL?.split("?")[0] === ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)}) {
        return { url: ${JSON.stringify(buildInfoModule)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

await esmock("../src/index.ts", {
  commander: { Command },
  "../src/gsmart.ts": { default: [] },
  "../src/utils/interrupt.ts": { dispatchInterrupt },
  "../src/utils/version-check.ts": { checkForUpdates: () => {} },
  "../src/utils/welcome.ts": { showWelcomeOnce: () => {} },
});

const [mode, root] = process.argv.slice(2);
if (mode === "editor") {
  const script = join(root, "waiting-editor.cjs");
  writeFileSync(script, "setInterval(() => {}, 1000);");
  const edit = createMessageEditor({
    env: () => ({ EDITOR: `"${process.execPath}" "${script}"` }),
    tempDirectory: () => root,
    runEditor: (command, file, platform) => {
      const result = runEditor(command, file, platform);
      process.send?.({ type: "ready", file });
      return result;
    },
  });
  await edit("feat: keep this candidate");
} else {
  let finish!: () => void;
  // Keep the simulated request alive until asynchronous cancellation completes.
  const keepAlive = setInterval(() => {}, 1000);
  await withInterruptHandler(
    () => {
      // Model asynchronous request cancellation/cleanup, not an immediate return.
      setTimeout(() => {
        clearInterval(keepAlive);
        process.send?.({ type: "cleaned" });
        finish();
      }, 25);
    },
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        process.send?.({ type: "ready" });
      }),
  );
}

process.send?.({ type: "resumed" });
// Represent the next interactive review prompt keeping the CLI alive.
setInterval(() => {}, 1000);
