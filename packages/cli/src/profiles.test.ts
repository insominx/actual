import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readProfiles,
  saveProfiles,
  selectedProfile,
  validateProfile,
} from './profiles';

describe('device-local profiles', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'actual-profile-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('does not write defaults when profiles are missing', async () => {
    const path = join(dir, 'profiles.json');
    expect(await readProfiles(path)).toEqual({
      schemaVersion: 1,
      profiles: {},
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('persists only explicit local configuration and resolves selected profiles', async () => {
    const path = join(dir, 'profiles.json');
    const profile = validateProfile({
      serverUrl: 'http://localhost:5006',
      syncId: 'budget-a',
      passwordFile: join(dir, 'password'),
    });
    await saveProfiles(
      {
        schemaVersion: 1,
        selected: 'personal',
        profiles: { personal: profile },
      },
      path,
    );
    expect(await selectedProfile(undefined, path)).toEqual(profile);
    await expect(selectedProfile('missing', path)).rejects.toThrow(
      'Unknown profile',
    );
  });
  it('rejects plaintext credentials, unknown fields, and ambiguous selectors', () => {
    expect(() =>
      validateProfile({ serverUrl: 'http://user:secret@localhost:5006' }),
    ).toThrow();
    expect(() => validateProfile({ password: 'secret' })).toThrow(
      'Invalid profile field',
    );
    expect(() => validateProfile({ secretToken: 'secret' })).toThrow(
      'Invalid profile field',
    );
    expect(() =>
      validateProfile({ syncId: 'sync', budgetId: 'local' }),
    ).toThrow('not both');
    expect(validateProfile({ budgetId: 'local', offline: true })).toEqual({
      budgetId: 'local',
      offline: true,
    });
  });
});
