import { CommanderError } from 'commander';

import { AgentError, writeAgentError } from './agent-output';
import { createProgram, wantsAgentOutput } from './program';

const program = createProgram();
const version2 = wantsAgentOutput(program, process.argv.slice(2));
if (version2) {
  program.exitOverride();
  program.configureOutput({
    writeErr: () => {
      /* The structured error replaces Commander's text diagnostic. */
    },
  });
}

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError && error.exitCode === 0) return;
  if (version2) {
    writeAgentError(
      error instanceof CommanderError
        ? new AgentError(
            'INVALID_INPUT',
            'Invalid command arguments. Run the operation with --help.',
            false,
            { commanderCode: error.code },
          )
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
