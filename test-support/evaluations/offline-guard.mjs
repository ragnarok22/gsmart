// Test-only import/network tripwire for the real offline developer entrypoint.
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(String.raw`
    export async function resolve(specifier, context, nextResolve) {
      const result = await nextResolve(specifier, context);
      if (/\/src\/utils\/(?:ai|config|openai-oauth)\.[cm]?[jt]s(?:\?|$)/.test(result.url) ||
          /\/node_modules\/(?:[^/]+\/)*?(?:conf|@ai-sdk|ai)\//.test(result.url) ||
          (/^node:(?:http|https|net|tls)$/.test(result.url) && /\/src\//.test(context.parentURL ?? ""))) {
        throw new Error("Offline evaluation imported a credential/network dependency: " + result.url);
      }
      return result;
    }
  `)}`,
  import.meta.url,
);

globalThis.fetch = () => {
  throw new Error("Offline evaluation attempted a network request");
};
