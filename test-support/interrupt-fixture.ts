import "./setup-env";
import esmock from "esmock";
import { writeFileSync } from "node:fs";
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
