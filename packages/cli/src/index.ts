import { CommanderError } from 'commander';
import type { Command } from 'commander';

import { AgentError, writeAgentError } from './agent-output';
import { createProgram, wantsAgentOutput } from './program';

// These messages name a flag or argument, never a value the user typed, so they
// are safe to show; anything else keeps the generic text.
const NAMED_USAGE_ERRORS = new Set([
  'commander.missingMandatoryOptionValue',
  'commander.missingArgument',
  'commander.optionMissingArgument',
  'commander.unknownOption',
  'commander.unknownCommand',
]);

function usageMessage(error: CommanderError) {
  return NAMED_USAGE_ERRORS.has(error.code)
    ? `Invalid command arguments: ${error.message.replace(/^error: /, '')}. Run the operation with --help.`
    : 'Invalid command arguments. Run the operation with --help.';
}

const program = createProgram();
const version2 = wantsAgentOutput(program, process.argv.slice(2));
// Commander copies these settings to subcommands only when they are created,
// so apply them to every existing command; otherwise a missing option on a
// subcommand printed text and exited 1 instead of a structured INVALID_INPUT.
function applyStructuredErrors(command: Command) {
  command.exitOverride();
  command.configureOutput({
    writeErr: () => {
      /* The structured error replaces Commander's text diagnostic. */
    },
  });
  command.commands.forEach(applyStructuredErrors);
}
if (version2) applyStructuredErrors(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError && error.exitCode === 0) return;
  if (version2) {
    writeAgentError(
      error instanceof CommanderError
        ? new AgentError('INVALID_INPUT', usageMessage(error), false, {
            commanderCode: error.code,
          })
        : error,
    );
  } else {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'object' && error !== null) {
      try {
        message = JSON.stringify(error);
      } catch {
        message = '<non-serializable error>';
      }
    } else {
      message = String(error);
    }
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
});
