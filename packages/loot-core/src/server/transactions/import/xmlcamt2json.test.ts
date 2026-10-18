import { describe, expect, it } from 'vitest';

import { xmlCAMT2json } from './xmlcamt2json';

function camt(entries: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document><BkToCstmrStmt><Stmt>${entries}</Stmt></BkToCstmrStmt></Document>`;
}

describe('xmlCAMT2json', () => {
  it('drops entries without a usable amount instead of importing -0', async () => {
    const result = await xmlCAMT2json(
      camt(`
        <Ntry><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2024-01-02</Dt></ValDt></Ntry>
        <Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2024-01-03</Dt></ValDt></Ntry>
      `),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: -5, date: '2024-01-03' });
  });
});
