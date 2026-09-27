import { Argument as CommanderArgument, Command } from "commander";
import type { ICommand } from "./definitions";
import { isMachineWorkflow } from "./utils/generation-options";
import { WorkflowError } from "./utils/workflow-result";

type ActionHook = (
  command: ICommand,
  options: Record<string, unknown>,
) => void | Promise<void>;

export type ProgramOptions = {
  commands: readonly ICommand[];
  metadata: { name: string; version: string; description: string };
  onDebug?: () => void | Promise<void>;
  beforeAction?: ActionHook;
  afterAction?: ActionHook;
};

/** Build the CLI without loading commands or performing startup side effects. */
export const createProgram = ({
  commands,
  metadata,
  onDebug,
  beforeAction,
  afterAction,
}: ProgramOptions): Command => {
  const program = new Command()
    .name(metadata.name)
    .version(metadata.version)
    .description(metadata.description)
    .option("-D, --debug", "Enable debug logging", false)
    .allowExcessArguments(false)
    // A root action disables implicit help unless it is explicitly enabled.
    .helpCommand(true);

  const addOptions = (cmd: Command, descriptor: ICommand) => {
    for (const option of descriptor.options ?? []) {
      if (
        cmd !== program &&
        descriptor.inheritGenerationOptions &&
        program.options.some((rootOption) => rootOption.flags === option.flags)
      )
        continue;
      cmd.option(option.flags, option.description, option.default);
    }
  };

  const addAction = (cmd: Command, descriptor: ICommand) => {
    for (const argument of descriptor.arguments ?? []) {
      const syntax = argument.required
        ? `<${argument.name}>`
        : `[${argument.name}]`;
      const arg = new CommanderArgument(syntax, argument.description);
      if (argument.choices) arg.choices(argument.choices);
      cmd.addArgument(arg);
    }

    cmd.action(async (...actionArgs: unknown[]) => {
      const options = cmd.optsWithGlobals<Record<string, unknown>>();
      descriptor.arguments?.forEach((argument, index) => {
        options[argument.name] = actionArgs[index];
      });

      // Commander validates options and positional arguments before this runs.
      const machine = isMachineWorkflow(options);
      if (machine && !descriptor.default)
        throw new WorkflowError(
          "USAGE",
          "Machine workflow flags apply only to generation, not other subcommands.",
        );
      if (options.debug) await onDebug?.();
      if (!descriptor.silent && !machine)
        await beforeAction?.(descriptor, options);
      await descriptor.action(options);
      if (!descriptor.silent && !machine)
        await afterAction?.(descriptor, options);
    });
  };

  for (const descriptor of commands) {
    if (descriptor.default) {
      addOptions(program, descriptor);
      addAction(program, descriptor);

      const alias = program
        .command(descriptor.name, { hidden: true })
        .description(descriptor.description)
        .configureHelp({ showGlobalOptions: true });
      // Inherit generation options from the root. Duplicating them here would
      // let ancestor defaults override explicit alias values in optsWithGlobals.
      addAction(alias, descriptor);
    } else {
      const cmd = program
        .command(descriptor.name)
        .description(descriptor.description);
      if (descriptor.inheritGenerationOptions)
        cmd.configureHelp({ showGlobalOptions: true });
      addOptions(cmd, descriptor);
      addAction(cmd, descriptor);
    }
  }

  return program;
};
