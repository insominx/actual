import { html2Plain, ofx2json } from './ofx2json';

describe('html2Plain', () => {
  test('regular text works', async () => {
    expect(html2Plain('Hello, world!')).toBe('Hello, world!');
    expect(html2Plain('Hello, <b>world</b>!')).toBe('Hello, <b>world</b>!');
  });

  test('brackets are unescaped', async () => {
    expect(html2Plain('Hello, &lt;world&gt;!')).toBe('Hello, <world>!');
  });
  test('apostrophes are unescaped', async () => {
    expect(html2Plain('Hello, &#39;world&#39;!')).toBe("Hello, 'world'!");
  });
  test('quotes are unescaped', async () => {
    expect(html2Plain('Hello, &quot;world&quot;!')).toBe('Hello, "world"!');
  });
  test('ampersands are unescaped', async () => {
    expect(html2Plain('Hello, &amp;world&amp;!')).toBe('Hello, &world&!');
    expect(html2Plain('Hello, &#038;world&#038;!')).toBe('Hello, &world&!');
  });
  test('no double unescaping with other entities', async () => {
    expect(html2Plain('Hello, &amp;#038;world&amp;#038;!')).toBe(
      'Hello, &#038;world&#038;!',
    );
    expect(html2Plain('Hello, &#038;amp;world&#038;amp;!')).toBe(
      'Hello, &amp;world&amp;!',
    );
    expect(html2Plain('Hello, &amp;quot;world&amp;quot;!')).toBe(
      'Hello, &quot;world&quot;!',
    );
  });
});

describe('ofx2json investment statements', () => {
  test('parses a single INVBANKTRAN entry', async () => {
    const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><INVTRANLIST><INVBANKTRAN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240102<TRNAMT>-5.00<FITID>1<NAME>X</STMTTRN></INVBANKTRAN></INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const { transactions } = await ofx2json(ofx);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      amount: '-5.00',
      fitId: '1',
      date: '2024-01-02',
    });
  });

  test('a transaction without a posted date does not fail the file', async () => {
    const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<TRNAMT>-1.00<FITID>missing<NAME>No date</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240103<TRNAMT>-2.00<FITID>ok<NAME>Has date</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const { transactions } = await ofx2json(ofx);
    expect(transactions).toEqual([
      expect.objectContaining({ fitId: 'missing', date: null }),
      expect.objectContaining({ fitId: 'ok', date: '2024-01-03' }),
    ]);
  });
});
