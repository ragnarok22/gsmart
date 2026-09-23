import type { Option } from "../definitions";

export const contextOptions: Option[] = [
  {
    flags: "--context-budget <tokens>",
    description:
      "Total AI token budget, including instructions and output reserve",
  },
  {
    flags: "--context-exclude <patterns...>",
    description:
      "Exclude matching repository-relative paths from AI context only",
  },
  {
    flags: "--summarize",
    description: "Allow extra AI requests to summarize oversized source diffs",
  },
  {
    flags: "--no-summarize",
    description:
      "Use local context reduction only, overriding repository settings",
  },
];
