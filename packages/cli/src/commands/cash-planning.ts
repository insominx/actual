import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import type { CliGlobalOpts } from '#config';
import { withConnection } from '#connection';
import { executeScopedChange } from '#guarded-changes';
import { printOutput } from '#output';

type CashPlanConfig = Awaited<ReturnType<typeof api.inspectCashPlan>>['config'];

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      `${field} must be valid JSON.`,
      false,
      {
        field,
      },
    );
  }
}

function parseAmount(value: string, field: string) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new AgentError(
      'INVALID_INPUT',
      `${field} must be an integer amount in cents.`,
      false,
      { field },
    );
  }
  return amount;
}

function requireOperationId(operationId: string | undefined, name: string) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      `Version 2 ${name} requires --operation-id for durable retry.`,
      false,
      { field: 'operationId' },
    );
  }
  return operationId;
}

async function savedConfig(opts: CliGlobalOpts): Promise<CashPlanConfig> {
  let config: CashPlanConfig | undefined;
  await withConnection(
    opts,
    async () => {
      config = (await api.inspectCashPlan()).saved.config;
    },
    { mutates: false },
  );
  if (!config) {
    throw new AgentError('ENGINE_FAILURE', 'Cash plan could not be read.');
  }
  return config;
}

// Saves the whole plan through the guarded cash-planning.save operation. The
// edit helpers read the saved plan first; a concurrent change between that
// read and apply makes the preview stale instead of being overwritten.
async function save(
  opts: CliGlobalOpts,
  operationId: string,
  config: CashPlanConfig | null,
) {
  return executeScopedChange(opts, operationId, 'cash-planning.save', {
    config,
  });
}

export function registerCashPlanningCommand(program: Command) {
  const plan = program
    .command('cash-planning')
    .description(
      'Inspect cash plans, run transient scenarios and save targets',
    );

  plan
    .command('inspect')
    .description(
      'Show balances, history averages, category totals, projections and goal dates; scenarios are transient and nothing is written',
    )
    .option('--start <date>', 'History start YYYY-MM-DD (default: saved plan)')
    .option('--end <date>', 'History end YYYY-MM-DD (default: saved plan)')
    .option(
      '--scenario <json>',
      'Transient overrides: {"categoryTargets":{"<id>":50000},"goal":{"balance":2000000,"deadline":"2027-06-30"},"forecastEndDate":"2027-12-31"}',
    )
    .action(
      async (cmdOpts: { start?: string; end?: string; scenario?: string }) => {
        const opts = program.opts();
        const scenario =
          cmdOpts.scenario === undefined
            ? undefined
            : parseJson(cmdOpts.scenario, 'scenario');
        await withConnection(
          opts,
          async () => {
            printOutput(
              await api.inspectCashPlan({
                ...(cmdOpts.start ? { startDate: cmdOpts.start } : {}),
                ...(cmdOpts.end ? { endDate: cmdOpts.end } : {}),
                ...(scenario === undefined
                  ? {}
                  : {
                      scenario: scenario as NonNullable<
                        Parameters<typeof api.inspectCashPlan>[0]
                      >['scenario'],
                    }),
              }),
              opts.format,
            );
          },
          { mutates: false },
        );
      },
    );

  plan
    .command('save')
    .description('Save a complete cash plan through a guarded change')
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption(
      '--data <json>',
      'Plan: {"startDate":"...","endDate":"...","categoryTargets":{},"goal":{"balance":0},"forecastEndDate":"..."}',
    )
    .action(async (cmdOpts: { operationId?: string; data: string }) => {
      const opts = program.opts();
      const operationId = requireOperationId(
        cmdOpts.operationId,
        'cash-planning.save',
      );
      printOutput(
        await save(
          opts,
          operationId,
          parseJson(cmdOpts.data, 'data') as CashPlanConfig,
        ),
        opts.format,
      );
    });

  plan
    .command('reset')
    .description(
      'Clear the saved plan so the report uses the last three complete months with no targets or goal',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .action(async (cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      const operationId = requireOperationId(
        cmdOpts.operationId,
        'cash-planning.reset',
      );
      printOutput(await save(opts, operationId, null), opts.format);
    });

  plan
    .command('set-target')
    .description('Set one monthly category target in the saved plan')
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--category <id>', 'Category ID')
    .requiredOption('--amount <cents>', 'Monthly target in cents (>= 0)')
    .action(
      async (cmdOpts: {
        operationId?: string;
        category: string;
        amount: string;
      }) => {
        const opts = program.opts();
        const operationId = requireOperationId(
          cmdOpts.operationId,
          'cash-planning.set-target',
        );
        const amount = parseAmount(cmdOpts.amount, 'amount');
        const config = await savedConfig(opts);
        printOutput(
          await save(opts, operationId, {
            ...config,
            categoryTargets: {
              ...config.categoryTargets,
              [cmdOpts.category]: amount,
            },
          }),
          opts.format,
        );
      },
    );

  plan
    .command('reset-target')
    .description(
      'Remove one category target so it uses its unrounded historical average',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--category <id>', 'Category ID')
    .action(async (cmdOpts: { operationId?: string; category: string }) => {
      const opts = program.opts();
      const operationId = requireOperationId(
        cmdOpts.operationId,
        'cash-planning.reset-target',
      );
      const config = await savedConfig(opts);
      const { [cmdOpts.category]: _removed, ...categoryTargets } =
        config.categoryTargets;
      printOutput(
        await save(opts, operationId, { ...config, categoryTargets }),
        opts.format,
      );
    });

  plan
    .command('set-goal')
    .description('Set the savings goal, and optionally its deadline')
    .option('--operation-id <id>', 'Required; durable retry ID')
    .option('--balance <cents>', 'Goal balance in cents')
    .option('--deadline <date>', 'Goal deadline YYYY-MM-DD')
    .option('--clear', 'Remove the goal instead', false)
    .action(
      async (cmdOpts: {
        operationId?: string;
        balance?: string;
        deadline?: string;
        clear: boolean;
      }) => {
        const opts = program.opts();
        const operationId = requireOperationId(
          cmdOpts.operationId,
          'cash-planning.set-goal',
        );
        if (!cmdOpts.clear && cmdOpts.balance === undefined) {
          throw new AgentError(
            'INVALID_INPUT',
            'Provide --balance, or --clear to remove the goal.',
            false,
            { field: 'balance' },
          );
        }
        const balance = cmdOpts.clear
          ? 0
          : parseAmount(cmdOpts.balance ?? '', 'balance');
        const { goal: _goal, ...config } = await savedConfig(opts);
        printOutput(
          await save(
            opts,
            operationId,
            cmdOpts.clear
              ? config
              : {
                  ...config,
                  goal: {
                    balance,
                    ...(cmdOpts.deadline ? { deadline: cmdOpts.deadline } : {}),
                  },
                },
          ),
          opts.format,
        );
      },
    );
}
