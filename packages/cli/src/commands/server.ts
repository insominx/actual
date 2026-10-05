import * as api from '@actual-app/api';
import { Option } from 'commander';
import type { Command } from 'commander';

import { AgentError, updateAgentContext } from '#agent-output';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { printOutput } from '#output';
import { bootstrapServer, serverUrl } from '#server-http';
import {
  initRuntime,
  runtimeLogs,
  runtimeStatus,
  startRuntime,
  stopRuntime,
} from '#server-runtime';
import { parseNonNegativeIntFlag } from '#utils';

export function registerServerCommand(program: Command) {
  const server = program.command('server').description('Server utilities');

  server
    .command('init')
    .description(
      'Create private loopback server configuration without starting it',
    )
    .requiredOption('--server-dir <path>', 'Server data directory')
    .option('--port <port>', 'Loopback server port', '5006')
    .option(
      '--server-entry <path>',
      'Built actual-server entry; defaults to the installed package',
    )
    .action(async opts =>
      printOutput(
        await initRuntime(
          opts.serverDir,
          parseNonNegativeIntFlag(opts.port, '--port'),
          opts.serverEntry,
        ),
      ),
    );
  server
    .command('start')
    .description('Start a CLI-managed server and await health')
    .requiredOption('--server-dir <path>', 'Initialized server data directory')
    .action(async opts => printOutput(await startRuntime(opts.serverDir)));
  server
    .command('status')
    .description('Verify managed server ownership and health')
    .requiredOption('--server-dir <path>', 'Initialized server data directory')
    .action(async opts => printOutput(await runtimeStatus(opts.serverDir)));
  server
    .command('stop')
    .description('Stop only the server held by the authenticated supervisor')
    .requiredOption('--server-dir <path>', 'Initialized server data directory')
    .action(async opts => printOutput(await stopRuntime(opts.serverDir)));
  server
    .command('logs')
    .description('Read the last 100 redacted supervisor lifecycle events')
    .requiredOption('--server-dir <path>', 'Initialized server data directory')
    .action(async opts => printOutput(await runtimeLogs(opts.serverDir)));

  server
    .command('bootstrap')
    .description('Initialize password authentication on a running fresh server')
    .action(async () => {
      const config = await resolveConfig(program.opts());
      if (config.offline || !config.password) {
        throw new AgentError(
          'MISSING_CONTEXT',
          'Bootstrap requires an online server and a first-run password.',
        );
      }
      const base = serverUrl(config.serverUrl);
      updateAgentContext({ serverUrl: new URL(base).origin });
      printOutput(await bootstrapServer(base, config.password));
    });

  server
    .command('version')
    .description('Get server version')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const version = await api.getServerVersion();
          printOutput({ version }, opts.format);
        },
        { mutates: false, skipBudget: true },
      );
    });

  server
    .command('get-id')
    .description('Get entity ID by name')
    .addOption(
      new Option('--type <type>', 'Entity type')
        .choices(['accounts', 'categories', 'payees', 'schedules'])
        .makeOptionMandatory(),
    )
    .requiredOption('--name <name>', 'Entity name')
    .action(async cmdOpts => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const id = await api.getIDByName(cmdOpts.type, cmdOpts.name);
          printOutput(
            { id, type: cmdOpts.type, name: cmdOpts.name },
            opts.format,
          );
        },
        { mutates: false },
      );
    });

  server
    .command('bank-sync')
    .description('Run bank synchronization')
    .option('--account <id>', 'Specific account ID to sync')
    .action(async cmdOpts => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const args = cmdOpts.account
            ? { accountId: cmdOpts.account }
            : undefined;
          await api.runBankSync(args);
          printOutput({ success: true }, opts.format);
        },
        { mutates: true },
      );
    });
}
