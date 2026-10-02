import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { readJsonInput } from '#input';
import { printOutput } from '#output';
import { readProfiles, saveProfiles, validateProfile } from '#profiles';

export function registerProfilesCommand(program: Command) {
  const profiles = program
    .command('profiles')
    .description('Manage device-local profiles and secret file references');
  profiles.command('list').action(async () => {
    const store = await readProfiles(program.opts().profilesFile);
    printOutput(
      Object.keys(store.profiles).map(name => ({
        name,
        selected: store.selected === name,
      })),
    );
  });
  profiles.command('show <name>').action(async (name: string) => {
    const store = await readProfiles(program.opts().profilesFile);
    if (!Object.keys(store.profiles).includes(name)) {
      throw new AgentError('MISSING_CONTEXT', 'Profile does not exist.');
    }
    printOutput({ name, ...store.profiles[name] });
  });
  profiles
    .command('set <name>')
    .option('--file <path>', 'Profile JSON; use - for stdin')
    .option('--data <json>', 'Profile JSON')
    .action(async (name: string, opts) => {
      if (!name.trim()) {
        throw new AgentError(
          'INVALID_INPUT',
          'Profile name must not be empty.',
        );
      }
      const profile = validateProfile(readJsonInput(opts));
      const store = await readProfiles(program.opts().profilesFile);
      Object.defineProperty(store.profiles, name, {
        value: profile,
        configurable: true,
        enumerable: true,
        writable: true,
      });
      await saveProfiles(store, program.opts().profilesFile);
      printOutput({ name, saved: true });
    });
  profiles.command('use <name>').action(async (name: string) => {
    const store = await readProfiles(program.opts().profilesFile);
    if (!Object.keys(store.profiles).includes(name)) {
      throw new AgentError('MISSING_CONTEXT', 'Profile does not exist.');
    }
    store.selected = name;
    await saveProfiles(store, program.opts().profilesFile);
    printOutput({ selected: name });
  });
}
