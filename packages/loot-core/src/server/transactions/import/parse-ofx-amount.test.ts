import { parseOfxAmount } from './parse-file';

describe('parseOfxAmount', () => {
  it('keeps a trailing minus negative, including a comma decimal', () => {
    expect(parseOfxAmount('12.50-')).toBe(-12.5);
    expect(parseOfxAmount('12,50-')).toBe(-12.5);
    expect(parseOfxAmount('$1,234.56-')).toBe(-1234.56);
    expect(parseOfxAmount('30.00−')).toBe(-30);
  });

  it('reads a period as thousands when the comma is the decimal mark', () => {
    expect(parseOfxAmount('1.234,56')).toBe(1234.56);
    expect(parseOfxAmount('1.234,56-')).toBe(-1234.56);
    expect(parseOfxAmount('-1.234,56')).toBe(-1234.56);
  });

  it('still reads a leading minus, parentheses, and a zero amount', () => {
    expect(parseOfxAmount('-12,50')).toBe(-12.5);
    expect(parseOfxAmount('(30.00)')).toBe(-30);
    expect(parseOfxAmount('1,234.56')).toBe(1234.56);
    expect(parseOfxAmount('0.00')).toBe(0);
  });

  it('rejects an amount that is not a number', () => {
    expect(parseOfxAmount('')).toBeNull();
    expect(parseOfxAmount('abc')).toBeNull();
  });
});
