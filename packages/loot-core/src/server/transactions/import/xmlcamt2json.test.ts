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

  it('uses the booking date when the value date is in another month', async () => {
    const result = await xmlCAMT2json(
      camt(`
        <Ntry>
          <Amt Ccy="EUR">8.00</Amt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <BookgDt><Dt>2024-03-01</Dt></BookgDt>
          <ValDt><Dt>2024-02-28</Dt></ValDt>
        </Ntry>
      `),
    );
    expect(result).toEqual([
      expect.objectContaining({ amount: -8, date: '2024-03-01' }),
    ]);
  });

  it('reads a note or payee that has an attribute', async () => {
    const result = await xmlCAMT2json(
      camt(`
        <Ntry>
          <Amt Ccy="EUR">3.00</Amt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <BookgDt><Dt>2024-04-01</Dt></BookgDt>
          <NtryDtls>
            <TxDtls>
              <RltdPties><Cdtr><Nm xml:lang="en">Shop A</Nm></Cdtr></RltdPties>
              <RmtInf><Ustrd xml:lang="en">Invoice 9</Ustrd></RmtInf>
            </TxDtls>
          </NtryDtls>
        </Ntry>
      `),
    );
    expect(result).toEqual([
      expect.objectContaining({
        amount: -3,
        payee_name: 'Shop A',
        notes: 'Invoice 9',
      }),
    ]);
  });

  it('reads an amount that has no currency attribute', async () => {
    const result = await xmlCAMT2json(
      camt(
        `<Ntry><Amt>12.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2024-02-01</Dt></BookgDt></Ntry>`,
      ),
    );
    expect(result).toEqual([
      expect.objectContaining({ amount: 12.5, date: '2024-02-01' }),
    ]);
  });

  it('keeps the entry amount when detail rows have no amounts of their own', async () => {
    const result = await xmlCAMT2json(
      camt(`
        <Ntry>
          <Amt Ccy="EUR">15.00</Amt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <BookgDt><Dt>2024-03-01</Dt></BookgDt>
          <AcctSvcrRef>batch-1</AcctSvcrRef>
          <NtryDtls>
            <TxDtls><RltdPties><Cdtr><Nm>Shop A</Nm></Cdtr></RltdPties></TxDtls>
            <TxDtls><RltdPties><Cdtr><Nm>Shop B</Nm></Cdtr></RltdPties></TxDtls>
          </NtryDtls>
        </Ntry>
      `),
    );
    expect(result).toEqual([
      expect.objectContaining({
        amount: -15,
        date: '2024-03-01',
        payee_name: 'Shop A',
        imported_id: 'batch-1',
      }),
    ]);
  });

  it('keeps a credit detail positive inside a debit batch', async () => {
    const result = await xmlCAMT2json(
      camt(`
        <Ntry>
          <Amt Ccy="EUR">6.00</Amt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <BookgDt><Dt>2024-03-03</Dt></BookgDt>
          <NtryDtls>
            <TxDtls>
              <Amt Ccy="EUR">10.00</Amt>
              <CdtDbtInd>DBIT</CdtDbtInd>
              <RltdPties><Cdtr><Nm>Shop A</Nm></Cdtr></RltdPties>
            </TxDtls>
            <TxDtls>
              <Amt Ccy="EUR">4.00</Amt>
              <CdtDbtInd>CRDT</CdtDbtInd>
              <RltdPties><Dbtr><Nm>Refund</Nm></Dbtr></RltdPties>
            </TxDtls>
          </NtryDtls>
        </Ntry>
      `),
    );
    expect(result).toEqual([
      expect.objectContaining({ amount: -10, payee_name: 'Shop A' }),
      expect.objectContaining({ amount: 4, payee_name: 'Refund' }),
    ]);
  });

  it('imports each detail that carries its own amount', async () => {
    const result = await xmlCAMT2json(
      camt(`
        <Ntry>
          <Amt Ccy="EUR">15.00</Amt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <BookgDt><Dt>2024-03-02</Dt></BookgDt>
          <NtryDtls>
            <TxDtls>
              <Amt Ccy="EUR">10.00</Amt>
              <RltdPties><Cdtr><Nm>Shop A</Nm></Cdtr></RltdPties>
            </TxDtls>
            <TxDtls>
              <Amt Ccy="EUR">5.00</Amt>
              <RltdPties><Cdtr><Nm>Shop B</Nm></Cdtr></RltdPties>
            </TxDtls>
          </NtryDtls>
        </Ntry>
      `),
    );
    expect(result).toEqual([
      expect.objectContaining({ amount: -10, payee_name: 'Shop A' }),
      expect.objectContaining({ amount: -5, payee_name: 'Shop B' }),
    ]);
  });
});
