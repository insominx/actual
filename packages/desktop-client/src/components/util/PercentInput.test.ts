import { parsePercentText, sanitizePercentText } from './PercentInput';

describe('sanitizePercentText', () => {
  it('keeps digits and the decimal point', () => {
    expect(sanitizePercentText('12.5', '.')).toBe('12.5');
    expect(sanitizePercentText('12.5%', '.')).toBe('12.5');
  });

  it('treats a typed decimal comma as the decimal point when the format uses one', () => {
    expect(sanitizePercentText('12,5', ',')).toBe('12.5');
    expect(sanitizePercentText('0,25', ',')).toBe('0.25');
  });

  it('still drops a comma for decimal-point formats', () => {
    expect(sanitizePercentText('1,000', '.')).toBe('1000');
  });

  it('removes anything else', () => {
    expect(sanitizePercentText('a1b2-3', '.')).toBe('123');
  });
});

describe('parsePercentText', () => {
  it('reads plain dot-decimal text as typed', () => {
    expect(parsePercentText('12.5')).toBe(12.5);
    expect(parsePercentText('0.125')).toBe(0.125);
    expect(parsePercentText('.5')).toBe(0.5);
    expect(parsePercentText('12.5%')).toBe(12.5);
  });

  it('treats empty or invalid text as zero', () => {
    expect(parsePercentText('')).toBe(0);
    expect(parsePercentText('%')).toBe(0);
    expect(parsePercentText('abc')).toBe(0);
  });
});
