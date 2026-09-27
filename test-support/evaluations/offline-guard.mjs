// Test-only import/network tripwire for the real offline developer entrypoint.
import * as module from "node:module";

// Keep this self-contained: the legacy loader runs it in a separate thread.
function checkResolution(result, context) {
  if (
    /\/src\/utils\/(?:ai|config|openai-oauth)\.[cm]?[jt]s(?:\?|$)/.test(
      result.url,
    ) ||
    /\/node_modules\/(?:[^/]+\/)*?(?:conf|@ai-sdk|ai)\//.test(result.url) ||
    (/^node:(?:http|https|net|tls)$/.test(result.url) &&
      /\/src\//.test(context.parentURL ?? ""))
  ) {
    throw new Error(
      "Offline evaluation imported a credential/network dependency: " +
        result.url,
    );
  }
  return result;
}

if (typeof module.registerHooks === "function") {
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      return checkResolution(nextResolve(specifier, context), context);
    },
  });
} else {
  // Node 22.14 predates synchronous hooks; preserve its asynchronous fallback.
  module.register(
    `data:text/javascript,${encodeURIComponent(`
      ${checkResolution.toString()}
      export async function resolve(specifier, context, nextResolve) {
        return checkResolution(await nextResolve(specifier, context), context);
      }
    `)}`,
    import.meta.url,
  );
}

globalThis.fetch = () => {
  throw new Error("Offline evaluation attempted a network request");
};
