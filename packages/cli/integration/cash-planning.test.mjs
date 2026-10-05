import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

// Packaged proof for cash planning: signed balances, history averages,
// transient scenarios and guarded saves that change only cashPlanning.

void test('cash plan balances, averages, scenarios and guarded saves on a clean budget', async () => {
  const f = await createFixture();
  try {
    const created = await f.cli([
      '--offline',
      'budgets',
      'create',
      '--name',
      'Cash plan proof',
      '--operation-id',
      'cash-plan-budget',
      '--currency',
      'USD',
    ]);
    assert.equal(created.code, 0, created.stderr + created.stdout);
    const budget = JSON.parse(created.stdout).data.id;
    const run = async (args, version = '2') => {
      const result = await f.cli(
        ['--offline', '--budget-id', budget, ...args],
        {
          version,
        },
      );
      assert.equal(result.code, 0, result.stdout + result.stderr);
      const parsed = JSON.parse(result.stdout);
      return parsed.data ?? parsed;
    };
    const cash = (
      await run([
        'accounts',
        'create',
        '--name',
        'Cash',
        '--balance',
        '1000000',
        '--operation-id',
        'plan-cash',
      ])
    ).id;
    await run([
      'accounts',
      'create',
      '--name',
      'Card',
      '--balance',
      '-200000',
      '--operation-id',
      'plan-card',
    ]);
    await run([
      'accounts',
      'create',
      '--name',
      'Brokerage',
      '--offbudget',
      '--balance',
      '900000',
      '--operation-id',
      'plan-offbudget',
    ]);

    // A1: on-budget cash and card net to 800000; off-budget equity excluded.
    let view = await run(['cash-planning', 'inspect']);
    assert.equal(view.summary.balance, 800000);
    assert.equal(view.saved.stored, false);

    const group = (
      await run(['category-groups', 'create', '--name', 'Living'], '1')
    ).id;
    const rent = (
      await run(
        ['categories', 'create', '--name', 'Rent', '--group-id', group],
        '1',
      )
    ).id;
    await run(
      [
        'transactions',
        'add',
        '--account',
        cash,
        '--data',
        JSON.stringify([
          { date: '2026-08-05', amount: 600000, notes: 'pay aug' },
          { date: '2026-09-05', amount: 600000, notes: 'pay sep' },
          { date: '2026-08-10', amount: -400000, category: rent },
          { date: '2026-09-10', amount: -400000, category: rent },
        ]),
      ],
      '1',
    );
    const range = ['--start', '2026-08-01', '--end', '2026-09-30'];
    const ledger = () =>
      run(
        [
          'transactions',
          'list',
          '--account',
          cash,
          '--start',
          '2026-01-01',
          '--end',
          '2026-12-31',
        ],
        '1',
      );
    const ledgerBefore = await ledger();
    view = await run(['cash-planning', 'inspect', ...range]);
    assert.equal(view.summary.months, 2);
    assert.equal(view.summary.monthlyIncome, 600000);
    assert.equal(view.summary.monthlyOutflow, 400000);
    assert.equal(view.summary.balance, 1200000);
    assert.equal(view.projections.historical.monthlySurplus, 200000);

    // A2: a goal 1200000 above the balance at 200000 a month is six months out.
    const goal = await run([
      'cash-planning',
      'inspect',
      ...range,
      '--scenario',
      JSON.stringify({ goal: { balance: 2400000 } }),
    ]);
    assert.equal(goal.projections.historical.remaining, 1200000);
    assert.equal(goal.projections.historical.goalState, 'reachable');
    assert.ok(goal.projections.historical.completionDate > goal.asOf);

    // A3: a target scenario changes only the target projection, transiently.
    const scenario = await run([
      'cash-planning',
      'inspect',
      ...range,
      '--scenario',
      JSON.stringify({ categoryTargets: { [rent]: 100000 } }),
    ]);
    assert.deepEqual(
      scenario.projections.historical,
      view.projections.historical,
    );
    assert.equal(scenario.projections.targets.monthlyOutflow, 100000);
    assert.equal(
      (await run(['cash-planning', 'inspect'])).saved.stored,
      false,
      'scenario was stored',
    );

    const plan = {
      startDate: '2026-08-01',
      endDate: '2026-09-30',
      categoryTargets: {},
      forecastEndDate: '2027-12-31',
    };
    const saved = await run([
      'cash-planning',
      'save',
      '--data',
      JSON.stringify(plan),
      '--operation-id',
      'plan-save',
    ]);
    assert.equal(saved.receipt.outcome.status, 'committed-local');
    const retried = await run([
      'cash-planning',
      'save',
      '--data',
      JSON.stringify(plan),
      '--operation-id',
      'plan-save',
    ]);
    assert.deepEqual(retried.receipt.outcome, saved.receipt.outcome);
    await run([
      'cash-planning',
      'set-target',
      '--category',
      rent,
      '--amount',
      '150000',
      '--operation-id',
      'plan-target',
    ]);
    await run([
      'cash-planning',
      'set-goal',
      '--balance',
      '2400000',
      '--deadline',
      '2027-06-30',
      '--operation-id',
      'plan-goal',
    ]);
    view = await run(['cash-planning', 'inspect']);
    assert.deepEqual(view.saved.config, {
      ...plan,
      categoryTargets: { [rent]: 150000 },
      goal: { balance: 2400000, deadline: '2027-06-30' },
    });
    assert.equal(view.projections.targets.monthlyOutflow, 150000);
    assert.ok(view.projections.targets.deadline);

    await run([
      'cash-planning',
      'reset-target',
      '--category',
      rent,
      '--operation-id',
      'plan-reset-target',
    ]);
    view = await run(['cash-planning', 'inspect']);
    assert.deepEqual(view.saved.config.categoryTargets, {});
    assert.equal(
      view.projections.targets.monthlyOutflow,
      view.projections.historical.monthlyOutflow,
      'cleared target restores the unrounded average',
    );
    await run(['cash-planning', 'reset', '--operation-id', 'plan-reset']);
    assert.equal((await run(['cash-planning', 'inspect'])).saved.stored, false);
    assert.deepEqual(
      await ledger(),
      ledgerBefore,
      'plan writes changed ledger',
    );

    for (const args of [
      ['cash-planning', 'save', '--data', '{"startDate":"x"}'],
      ['cash-planning', 'set-target', '--category', rent, '--amount', '-1'],
      [
        'cash-planning',
        'inspect',
        '--scenario',
        '{"categoryTargets":{"a":-1}}',
      ],
      ['cash-planning', 'inspect', '--end', '2999-01-01'],
    ]) {
      const result = await f.cli([
        '--offline',
        '--budget-id',
        budget,
        ...args,
        ...(args[1] === 'inspect'
          ? []
          : ['--operation-id', `bad-${Math.random().toString(36).slice(2)}`]),
      ]);
      assert.notEqual(result.code, 0, args.join(' '));
    }
  } finally {
    await f.dispose();
  }
});
