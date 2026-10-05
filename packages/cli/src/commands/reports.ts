import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { printOutput } from '#output';
import { centsToDecimal, toCsv, toHtml } from '#report-export';
import type { ExportDocument, ExportFormat, ExportTable } from '#report-export';

type CashFlow = Awaited<ReturnType<typeof api.getCashFlowReport>>;
type Categories = Awaited<ReturnType<typeof api.getCategoryReport>>;
type NetWorth = Awaited<ReturnType<typeof api.getNetWorthReport>>;
type AnyReport = CashFlow | Categories | NetWorth;

type ReportOpts = {
  start: string;
  end: string;
  accounts?: string;
  includeFuture?: boolean;
  details?: boolean;
  export?: string;
  out?: string;
};

function money(name: string) {
  return [`${name}_cents`, name];
}

function amount(cents: number) {
  return [cents, centsToDecimal(cents)];
}

function detailsTable(
  details: api.ReportDetailRow[] | undefined,
): ExportTable[] {
  if (!details) return [];
  return [
    {
      title: 'Contributing transactions',
      columns: [
        'id',
        'date',
        'account',
        'payee',
        'category',
        'notes',
        ...money('amount'),
      ],
      rows: details.map(d => [
        d.id,
        d.date,
        d.account,
        d.payee,
        d.category,
        d.notes,
        ...amount(d.amount),
      ]),
    },
  ];
}

export function reportDocument(report: AnyReport): ExportDocument {
  const meta: Array<[string, string]> = [
    ['report', report.report],
    ['range', `${report.scope.start} to ${report.scope.end}`],
    ['cutoff', report.scope.cutoff],
    ['accounts', report.scope.accountIds?.join(' ') ?? report.scope.accounts],
    ['transfers', report.scope.transfers],
    ['splits', report.scope.splits],
    ['opening balances', report.scope.opening],
    ['future-dated', report.scope.futureDated],
    ['amounts', report.scope.amounts],
    ['completeness', report.completeness.note ?? 'complete for the range'],
  ];
  if ('truncated' in report && report.truncated) {
    meta.push(['contributing ids', 'truncated']);
  }
  const title = `Actual ${report.report} report ${report.scope.start} to ${report.scope.end}`;
  if (report.report === 'cash-flow') {
    return {
      title,
      meta,
      tables: [
        {
          title: 'Cash flow by month',
          columns: [
            'month',
            ...money('income'),
            ...money('expense'),
            ...money('net'),
            ...money('transfers_off_budget'),
            'count',
          ],
          rows: [
            ...report.months.map(m => [
              m.month,
              ...amount(m.income),
              ...amount(m.expense),
              ...amount(m.net),
              ...amount(m.transfersOffBudget),
              m.count,
            ]),
            [
              'total',
              ...amount(report.totals.income),
              ...amount(report.totals.expense),
              ...amount(report.totals.net),
              ...amount(report.totals.transfersOffBudget),
              null,
            ],
          ],
        },
        ...detailsTable(report.details),
      ],
    };
  }
  if (report.report === 'categories') {
    const months = report.categories[0]
      ? Object.keys(report.categories[0].months)
      : [];
    return {
      title,
      meta,
      tables: [
        {
          title: 'Categories by month',
          columns: [
            'category_id',
            'category',
            'kind',
            'deleted',
            ...months.flatMap(month => money(month)),
            ...money('total'),
          ],
          rows: report.categories.map(c => [
            c.categoryId,
            c.name,
            c.kind,
            c.deleted,
            ...months.flatMap(month => amount(c.months[month] ?? 0)),
            ...amount(c.total),
          ]),
        },
        ...detailsTable(report.details),
      ],
    };
  }
  return {
    title,
    meta,
    tables: [
      {
        title: 'Net worth by month end',
        columns: [
          'month',
          'as_of',
          ...money('net_worth'),
          ...money('net_cash'),
          ...money('tracking'),
        ],
        rows: report.months.map(m => [
          m.month,
          m.asOf,
          ...amount(m.netWorth),
          ...amount(m.netCash),
          ...amount(m.tracking),
        ]),
      },
    ],
  };
}

async function writeExport(path: string, content: string) {
  // 'wx' refuses to overwrite an existing file.
  let handle;
  try {
    handle = await open(path, 'wx', 0o644);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new AgentError(
      'INVALID_INPUT',
      code === 'EEXIST'
        ? `Refusing to overwrite existing file: ${path}`
        : `Cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

function addReport(
  program: Command,
  reports: Command,
  name: string,
  description: string,
  run: (request: api.ReportRequest) => Promise<AnyReport>,
) {
  reports
    .command(name)
    .description(description)
    .requiredOption('--start <month>', 'First month YYYY-MM')
    .requiredOption('--end <month>', 'Last month YYYY-MM (at most 60 months)')
    .option('--accounts <ids>', 'Comma-separated account IDs to include')
    .option('--include-future', 'Include future-dated transactions')
    .option('--details', 'Include contributing transaction rows')
    .option('--export <format>', 'Write csv or html to --out')
    .option('--out <file>', 'Export file path (never overwritten)')
    .action(async (cmdOpts: ReportOpts) => {
      const opts = program.opts();
      let format: ExportFormat | undefined;
      if (cmdOpts.export !== undefined) {
        if (cmdOpts.export !== 'csv' && cmdOpts.export !== 'html') {
          throw new AgentError(
            'INVALID_INPUT',
            '--export must be csv or html (pdf is not supported)',
          );
        }
        if (!cmdOpts.out) {
          throw new AgentError('INVALID_INPUT', '--export requires --out');
        }
        format = cmdOpts.export;
      } else if (cmdOpts.out !== undefined) {
        throw new AgentError('INVALID_INPUT', '--out requires --export');
      }
      const request: api.ReportRequest = {
        start: cmdOpts.start,
        end: cmdOpts.end,
        ...(cmdOpts.accounts === undefined
          ? {}
          : {
              accountIds: cmdOpts.accounts
                .split(',')
                .map(id => id.trim())
                .filter(Boolean),
            }),
        ...(cmdOpts.includeFuture ? { includeFuture: true } : {}),
        ...(cmdOpts.details ? { details: true } : {}),
      };
      await withConnection(
        opts,
        async () => {
          let result: AnyReport;
          try {
            result = await run(request);
          } catch (error) {
            throw new AgentError(
              'INVALID_INPUT',
              error instanceof Error ? error.message : String(error),
            );
          }
          if (!format || !cmdOpts.out) {
            printOutput(result, opts.format);
            return;
          }
          const doc = reportDocument(result);
          const content = format === 'csv' ? toCsv(doc) : toHtml(doc);
          const path = resolve(cmdOpts.out);
          await writeExport(path, content);
          printOutput(
            {
              report: result.report,
              format,
              path,
              bytes: Buffer.byteLength(content),
              scope: result.scope,
              completeness: result.completeness,
            },
            opts.format,
          );
        },
        { mutates: false },
      );
    });
}

export function registerReportsCommand(program: Command) {
  const reports = program
    .command('reports')
    .description(
      'Read-only cash flow, category and net worth reports with declared scope, completeness and optional CSV/HTML export',
    );
  addReport(
    program,
    reports,
    'cash-flow',
    'Monthly on-budget income, expense and net; transfers excluded and transfers to off-budget accounts listed separately',
    request => api.getCashFlowReport(request),
  );
  addReport(
    program,
    reports,
    'categories',
    'Income and spending by category per month; refunds net against their category and deleted categories are flagged',
    request => api.getCategoryReport(request),
  );
  addReport(
    program,
    reports,
    'net-worth',
    'Net worth, net cash (on-budget) and tracking (off-budget) balances at each month end',
    request => api.getNetWorthReport(request),
  );
}
