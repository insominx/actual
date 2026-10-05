import {
  centsToDecimal,
  csvCell,
  escapeHtml,
  toCsv,
  toHtml,
} from './report-export';

describe('report export', () => {
  it('renders cents as decimals without float drift', () => {
    expect(centsToDecimal(0)).toBe('0.00');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(-123456)).toBe('-1234.56');
    expect(centsToDecimal(1999)).toBe('19.99');
  });

  it('neutralizes formula-like text and quotes CSV cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\tcmd')).toBe(`"'\tcmd"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(-250)).toBe('-250');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });

  it('escapes HTML text', () => {
    expect(escapeHtml(`<script>alert('x')</script> & "q"`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;',
    );
  });

  it('builds documents with metadata and tables', () => {
    const doc = {
      title: 'T <b>',
      meta: [['completeness', 'unknown before 2024-01'] as [string, string]],
      tables: [
        {
          title: 'rows',
          columns: ['payee', 'amount_cents'],
          rows: [['=evil()', -100]],
        },
      ],
    };
    const csv = toCsv(doc);
    expect(csv).toContain('completeness,unknown before 2024-01\r\n');
    expect(csv).toContain(`"'=evil()",-100\r\n`);
    const html = toHtml(doc);
    expect(html).toContain('<title>T &lt;b&gt;</title>');
    expect(html).toContain('<td>=evil()</td><td>-100</td>');
    expect(html).not.toContain('<b>');
    expect(html).toContain("default-src 'none'");
  });
});
