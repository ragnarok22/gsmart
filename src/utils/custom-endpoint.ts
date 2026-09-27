import type prompts from "prompts";
import type config from "./config";
import { validateBaseURL, validateModel } from "./providers";

type PromptFn = (
  question: Parameters<typeof prompts>[0],
) => Promise<Record<string, unknown>>;
type CustomEndpointConfig = Pick<
  typeof config,
  | "getCustomBaseURL"
  | "getModel"
  | "setCustomBaseURL"
  | "setModel"
  | "setKey"
  | "clearKey"
>;

/** Gather and validate the whole setup before persisting any changes. */
export async function configureCustomEndpoint(
  prompt: PromptFn,
  store: CustomEndpointConfig,
): Promise<boolean> {
  const { baseURL } = await prompt({
    type: "text",
    name: "baseURL",
    message: "OpenAI-compatible API base URL (including /v1 if required)",
    initial: store.getCustomBaseURL() || "http://localhost:11434/v1",
  });
  if (typeof baseURL !== "string") return false;
  const endpoint = validateBaseURL(baseURL);
  const { model } = await prompt({
    type: "text",
    name: "model",
    message: "Model ID installed or available on this endpoint",
    initial: store.getModel("custom"),
  });
  if (typeof model !== "string") return false;
  const modelId = validateModel(model);
  const { key } = await prompt({
    type: "password",
    name: "key",
    message:
      "API key (leave blank for no authentication; replaces any saved key)",
  });
  if (typeof key !== "string") return false;

  store.setCustomBaseURL(endpoint);
  store.setModel("custom", modelId);
  if (key.trim()) store.setKey("custom", key.trim());
  else store.clearKey("custom");
  return true;
}
