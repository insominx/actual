import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { schedulerRecipes, validateJob } from './jobs';

// vitest hoists this mock; it keeps the engine out of these pure tests.
vi.mock('@actual-app/api', () => ({}));

// Creating symlinks needs a privilege that unprivileged Windows accounts lack
const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'symlink-probe-'));
  try {
    symlinkSync(dir, join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

const base = {
  name: 'nightly',
  budget: { syncId: 'sync-1', budgetId: null },
  inbox: '/tmp/jobs/inbox',
  processed: '/tmp/jobs/processed',
  error: '/tmp/jobs/error',
  routes: [{ match: '^checking-', account: 'acct' }],
  allow: ['imports.file'],
  allowCrossAccount: false,
  stableSeconds: 30,
};

describe('jobs', () => {
  it('validates explicit budget, directories, routes and mutations', () => {
    expect(validateJob(base).allowedMutations).toEqual(['imports.file']);
    expect(() =>
      validateJob({ ...base, budget: { syncId: null, budgetId: null } }),
    ).toThrow(/explicit budget/);
    expect(() =>
      validateJob({ ...base, processed: '/tmp/jobs/inbox/done' }),
    ).toThrow(/nested/);
    expect(() => validateJob({ ...base, allow: [] })).toThrow(/imports.file/);
    expect(() =>
      validateJob({ ...base, allow: ['imports.file', 'rules.apply'] }),
    ).toThrow(/imports.file/);
    expect(() =>
      validateJob({ ...base, routes: [{ match: '(', account: 'a' }] }),
    ).toThrow(/regular expression/);
    expect(() => validateJob({ ...base, name: 'Bad Name' })).toThrow(
      /lowercase/,
    );
  });

  it('detects nested directories named like parents and through symlinks', ({
    skip,
  }) => {
    skip(!canSymlink);
    const root = mkdtempSync(join(tmpdir(), 'job-dirs-'));
    const inbox = join(root, 'inbox');
    mkdirSync(inbox);
    mkdirSync(join(root, 'elsewhere'));
    // "..done" starts with two dots but is an ordinary child folder.
    expect(() =>
      validateJob({ ...base, inbox, processed: join(inbox, '..done') }),
    ).toThrow(/nested/);
    // A link into the inbox is the inbox for every purpose.
    symlinkSync(inbox, join(root, 'link'));
    expect(() =>
      validateJob({ ...base, inbox, processed: join(root, 'link', 'done') }),
    ).toThrow(/nested/);
    expect(() =>
      validateJob({ ...base, inbox, processed: join(root, 'link') }),
    ).toThrow(/nested|differ/);
    expect(
      validateJob({
        ...base,
        inbox,
        processed: join(root, 'elsewhere', 'a'),
        error: join(root, 'elsewhere', 'b'),
      }).name,
    ).toBe('nightly');
  });

  it('refuses names Windows reserves for devices', () => {
    for (const name of ['con', 'nul', 'aux', 'prn', 'com1', 'lpt9']) {
      expect(() => validateJob({ ...base, name })).toThrow(/device name/);
    }
    // Longer names that merely start with a device name stay valid.
    expect(validateJob({ ...base, name: 'nulls' }).name).toBe('nulls');
    expect(validateJob({ ...base, name: 'com10' }).name).toBe('com10');
  });

  it('prints scheduler recipes without credentials', () => {
    const recipe = schedulerRecipes(validateJob(base), {
      dataDir: '/data dir',
      minutes: 5,
    });
    expect(recipe.command.args).toEqual([
      '--data-dir',
      '/data dir',
      '--sync-id',
      'sync-1',
      'jobs',
      'run',
      'nightly',
    ]);
    expect(recipe.cron).toMatch(
      /^\*\/5 \* \* \* \* 'actual' '--data-dir' '\/data dir'/,
    );
    expect(recipe.windowsTaskScheduler).toContain('\\"/data dir\\"');
    expect(JSON.stringify(recipe)).not.toMatch(/password/i);
  });

  it('escapes cron and systemd specials and refuses line breaks', () => {
    const recipe = schedulerRecipes(validateJob(base), {
      dataDir: '/data/100%/$HOME',
    });
    expect(recipe.cron).toContain("'/data/100\\%/$HOME'");
    expect(recipe.cron).not.toMatch(/[^\\]%/);
    expect(recipe.systemdTimer.ExecStart).toContain("'/data/100%%/$$HOME'");
    expect(() =>
      schedulerRecipes(validateJob(base), { dataDir: '/data\n* * * * * evil' }),
    ).toThrow(/line breaks/);
  });
});
