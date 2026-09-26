import { Command, CommanderError } from "commander";
import type { Option } from "../definitions";
import { contextOptions } from "./context-options";
import type { ConventionOptions } from "./conventions";

export type GenerationCommandOptions = ConventionOptions & {
  provider?: string;
  model?: string;
  yes?: boolean;
  dryRun?: boolean;
  showContext?: boolean;
  output?: string;
  stdin?: boolean;
  branch?: string;
  stage?: boolean;
  commit?: boolean;
};

export const isMachineWorkflow = (options: GenerationCommandOptions): boolean =>
  options.output !== undefined ||
  options.stdin === true ||
  options.branch !== undefined ||
  options.stage === true ||
  options.commit === true;

export const generationContextOptions: Option[] = [
  ...contextOptions,
  {
    flags: "--show-context",
    description:
      "Show per-file AI context treatment and request budget accounting",
  },
  {
    flags: "-p, --prompt <prompt>",
    default: "",
    description: "The prompt to use for generating the commit message",
  },
  {
    flags: "--language <tag>",
    description: "Output language tag for this run (e.g. en, es, pt-BR)",
  },
  {
    flags: "--history-examples <count>",
    description:
      "Use 0–20 recent commit subjects as style examples (0 disables)",
  },
  {
    flags: "-P, --provider <provider>",
    description: "The AI provider to use for generating the commit message",
  },
  {
    flags: "--model <model>",
    description:
      "Model for this run (overrides the saved model and built-in default)",
  },
];

export const generationOptions: Option[] = [
  ...generationContextOptions,
  {
    flags: "-y, --yes",
    default: false,
    description:
      "Automatically commit without prompting (useful for automation)",
  },
  {
    flags: "-d, --dry-run",
    default: false,
    description:
      "Show the generated commit message and staged files without committing",
  },
  {
    flags: "--output <format>",
    description:
      "Noninteractive generation: message-only or JSON output (message, json)",
  },
  {
    flags: "--stdin",
    description: "Read the diff from stdin, without requiring a Git repository",
  },
  {
    flags: "--branch <name>",
    description: "Supply branch context for noninteractive generation",
  },
  {
    flags: "--stage",
    description:
      "Explicitly stage all changes before noninteractive generation",
  },
  {
    flags: "--commit",
    description:
      "Explicitly commit the verified staged changes after noninteractive generation",
  },
];

/** Side-effect-free bootstrap parsing, including values that look like flags.
 * The full program still owns validation, help, and command dispatch.
 */
export function inspectWorkflowArgs(
  args: string[],
): GenerationCommandOptions & { planning?: boolean } {
  const probe = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
  for (const option of generationOptions)
    probe.option(option.flags, option.description, option.default);
  probe.option("-D, --debug");
  let planning = false;
  try {
    const parsed = probe.parseOptions(args);
    planning = parsed.operands[0] === "plan";
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === "commander.optionMissingArgument"
    )
      planning = probe.parseOptions(args.slice(0, -1)).operands[0] === "plan";
    // Retain flags parsed before a missing value; the real parser reports it.
    if (
      error instanceof CommanderError &&
      error.code === "commander.optionMissingArgument" &&
      args.at(-1) === "--output" &&
      probe.opts().output === undefined
    )
      probe.setOptionValue("output", "message");
  }
  return {
    ...probe.opts<GenerationCommandOptions>(),
    ...(planning ? { planning } : {}),
  };
}
