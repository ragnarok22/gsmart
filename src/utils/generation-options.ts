import {
  Command,
  type Option as CommanderOption,
  type OptionValueSource,
} from "commander";
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

class WorkflowProbeCommand extends Command {
  private missingOption?: string;

  // Commander 15's runtime hook is private and absent from its typings.
  // Let parseOptions finish collecting operands; the real parser reports errors.
  optionMissingArgument(option: CommanderOption): void {
    this.missingOption = option.attributeName();
    if (
      this.missingOption === "output" &&
      this.getOptionValue("output") === undefined
    )
      super.setOptionValueWithSource("output", "message", "cli");
  }

  override setOptionValueWithSource(
    key: string,
    value: unknown,
    source: OptionValueSource,
  ): this {
    // Returning from the hook still emits an option event with an undefined value.
    // Ignore that write to preserve prior values, defaults, and variadic arrays.
    if (key === this.missingOption) {
      this.missingOption = undefined;
      return this;
    }
    return super.setOptionValueWithSource(key, value, source);
  }
}

/** Side-effect-free bootstrap parsing, including values that look like flags.
 * The full program still owns validation, help, and command dispatch.
 */
export function inspectWorkflowArgs(
  args: string[],
): GenerationCommandOptions & { planning?: boolean } {
  const probe = new WorkflowProbeCommand()
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
  for (const option of generationOptions)
    probe.option(option.flags, option.description, option.default);
  probe.option("-D, --debug");
  const parsed = probe.parseOptions(args);
  const planning = parsed.operands[0] === "plan";
  return {
    ...probe.opts<GenerationCommandOptions>(),
    ...(planning ? { planning } : {}),
  };
}
