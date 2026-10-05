import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { serveMcp } from '#mcp';

// Global options forwarded to every tool call: everything before "mcp"
// except output selection, which the adapter controls.
export function forwardedGlobalArgs(argv: string[]) {
  const end = argv.findIndex(
    (arg, i) => arg === 'mcp' && argv[i + 1] === 'serve',
  );
  const globals = argv.slice(0, end === -1 ? argv.length : end);
  const forwarded: string[] = [];
  for (let i = 0; i < globals.length; i++) {
    const arg = globals[i];
    if (arg === '--output-version' || arg === '--format') {
      i++;
      continue;
    }
    if (arg.startsWith('--output-version=') || arg.startsWith('--format=')) {
      continue;
    }
    forwarded.push(arg);
  }
  return forwarded;
}

export function registerMcpCommand(program: Command, version: string) {
  const mcp = program
    .command('mcp')
    .description(
      'Optional Model Context Protocol adapter over the CLI operations',
    );

  mcp
    .command('serve')
    .description(
      'Serve MCP over stdio (protocol on stdout, diagnostics on stderr); every tool runs the matching CLI operation',
    )
    .option(
      '--domains <list>',
      'Comma-separated domains to expose (default: all), e.g. accounts,transactions,changes',
    )
    .action(async (cmdOpts: { domains?: string }) => {
      if (program.opts().outputVersion === '2') {
        throw new AgentError(
          'INVALID_INPUT',
          'mcp serve writes MCP frames to stdout; omit --output-version.',
        );
      }
      const domains = cmdOpts.domains
        ?.split(',')
        .map(d => d.trim())
        .filter(Boolean);
      await serveMcp({
        root: program,
        ...(domains?.length ? { domains } : {}),
        globalArgs: forwardedGlobalArgs(process.argv.slice(2)),
        cliEntry: process.argv[1],
        version,
      });
    });
}
