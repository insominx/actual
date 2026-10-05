import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { printOutput } from '#output';
import { upgradeCheck } from '#upgrade-check';

function releaseLine(version: string) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

export function registerUpgradeCommand(program: Command, version: string) {
  const upgrade = program
    .command('upgrade')
    .description(
      'Upgrade diagnosis for device-local CLI state and server compatibility',
    );

  upgrade
    .command('check')
    .description(
      'Read-only: schema versions of profiles, receipts, workflow runs, jobs, bank sync runs and statement evidence, pending receipts, unfinished runs, and (with --server) the server version',
    )
    .option('--server', 'Also compare the server version with this CLI')
    .action(async (cmdOpts: { server?: boolean }) => {
      const opts = program.opts();
      const resolved = await resolveConfig(opts);
      const report = await upgradeCheck(
        resolved.dataDir,
        version,
        opts.profilesFile,
      );
      let server: Record<string, unknown> | undefined;
      if (cmdOpts.server) {
        await withConnection(
          opts,
          async () => {
            const serverVersion = await api.getServerVersion();
            const value =
              typeof serverVersion === 'string'
                ? serverVersion
                : JSON.stringify(serverVersion);
            const sameLine =
              releaseLine(value) !== null &&
              releaseLine(value) === releaseLine(version);
            server = {
              version: value,
              sameReleaseLine: sameLine,
              ...(sameLine
                ? {}
                : {
                    warning:
                      'The server and CLI are from different release lines. Upgrade both to the same release before relying on newer operations.',
                  }),
            };
          },
          { mutates: false, skipBudget: true },
        );
      }
      printOutput(server ? { ...report, server } : report, opts.format);
    });
}
