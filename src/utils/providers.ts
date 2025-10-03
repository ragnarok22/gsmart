import { IProvider } from "../definitions";

export const providers: IProvider[] = [
  {
    title: "OpenAI",
    value: "openai",
    description:
      "OpenAI is an artificial intelligence research laboratory consisting of the for-profit OpenAI LP and the non-profit OpenAI Inc.",
    active: true,
  },
  {
    title: "Anthropic",
    value: "anthropic",
    description:
      "Anthropic is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
    active: true,
  },
  {
    title: "Google AI",
    value: "google",
    description:
      "Google AI is a division of Google dedicated to artificial intelligence.",
    active: true,
  },
  {
    title: "Mistral",
    value: "mistral",
    description:
      "Mistral is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
    active: true,
  },
  {
    title: "Fireworks AI",
    value: "fireworks",
    description:
      "Fireworks AI is a research lab building large-scale AI systems that are steerable, aligned, and safe.",
    active: true,
  },
  {
    title: "PlataformIA",
    value: "plataformia",
    description:
      "PlataformIA is a Cuban AI platform offering tools for app creation, workflow automation, and content generation, with APIs for developers.",
    active: true,
  },
];

export const getActiveProviders = (): IProvider[] => {
  return providers.filter((provider) => provider.active);
};
