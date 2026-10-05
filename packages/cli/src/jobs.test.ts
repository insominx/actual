import { schedulerRecipes, validateJob } from './jobs';

// vitest hoists this mock; it keeps the engine out of these pure tests.
vi.mock('@actual-app/api', () => ({}));

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
});
