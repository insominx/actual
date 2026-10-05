import type { WorkflowRun, WorkflowStep } from './workflow-runs';
import {
  cancelRun,
  planSteps,
  runSummary,
  validateClose,
  validateSetup,
} from './workflows';

// vitest hoists this mock; it keeps the engine out of these pure tests.
vi.mock('@actual-app/api', () => ({}));

function run(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    schemaVersion: 1,
    runId: 'wf-test',
    workflow: 'monthly-close',
    budget: { syncId: 'sync', budgetId: null },
    input: {},
    status: 'paused',
    steps: [],
    unresolved: [],
    artifacts: [],
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('workflows', () => {
  it('plans fixed steps from validated input', () => {
    const setup = validateSetup({
      budgetName: 'Home',
      accounts: [{ name: 'Checking', initialBalance: 100 }],
      categoryGroups: [{ name: 'Bills', categories: ['Rent', 'Power'] }],
    });
    expect(
      planSteps('setup', setup as unknown as Record<string, unknown>).map(
        s => s.id,
      ),
    ).toEqual([
      'budget',
      'account-0',
      'group-0',
      'category-0-0',
      'category-0-1',
    ]);
    const close = validateClose({
      month: '2026-02',
      statements: [{ accountId: 'a', endingBalance: 5 }],
      finish: false,
    });
    expect(close.statements[0].date).toBe('2026-02-28');
    expect(
      planSteps(
        'monthly-close',
        close as unknown as Record<string, unknown>,
      ).map(s => s.id),
    ).toEqual(['reconcile-0', 'review']);
  });

  it('rejects invalid input before any side effect', () => {
    expect(() => validateSetup({ accounts: [] })).toThrow(/nothing to create/);
    expect(() =>
      validateClose({ month: '2026-9', statements: [], finish: false }),
    ).toThrow(/YYYY-MM/);
    expect(() =>
      validateClose({
        month: '2026-09',
        statements: [
          { accountId: 'a', endingBalance: 1 },
          { accountId: 'a', endingBalance: 2 },
        ],
        finish: true,
      }),
    ).toThrow(/one statement/);
    expect(() =>
      validateSetup({ accounts: [{ name: 'A', initialBalance: 1.5 }] }),
    ).toThrow(/cents/);
  });

  it('cancels with accurate partial outcomes', () => {
    const cancelled = cancelRun(
      run({
        steps: [
          { id: 'reconcile-0', kind: 'mutation', status: 'committed' },
          {
            id: 'reconcile-1',
            kind: 'mutation',
            status: 'pending',
            operationId: 'wf-test-reconcile-1',
            payload: { accountId: 'b' },
          },
          { id: 'review', kind: 'read', status: 'pending' },
        ],
      }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.steps.map(s => s.status)).toEqual([
      'committed',
      'pending',
      'not-run',
    ]);
    expect(() => cancelRun(run({ status: 'completed' }))).toThrow(
      /cannot be cancelled/,
    );
  });

  it('never claims a complete close with an unreconciled statement', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'reconcile-0',
        kind: 'mutation',
        status: 'committed',
        operationId: 'wf-test-reconcile-0',
      },
      {
        id: 'reconcile-1',
        kind: 'mutation',
        status: 'unresolved',
      },
      { id: 'review', kind: 'read', status: 'completed' },
    ];
    expect(
      runSummary(run({ status: 'needs-review', steps })).closeComplete,
    ).toBe(false);
    steps[1].status = 'committed';
    expect(
      runSummary(run({ status: 'needs-review', steps })).closeComplete,
    ).toBe(true);
    expect(runSummary(run({ status: 'paused', steps })).closeComplete).toBe(
      false,
    );
  });
});
