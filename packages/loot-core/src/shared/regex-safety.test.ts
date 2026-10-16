import { hasNestedRepeat } from './regex-safety';

describe('hasNestedRepeat', () => {
  it('flags repeated groups that contain repeats', () => {
    for (const pattern of [
      '(a+)+$',
      '(a*)*b',
      '^(([a-z])+.)+[A-Z]([a-z])+$',
      '(.*a){25}',
      '(x+x+)+y',
      '((a+))+',
      '(a{2,})+',
      '(?:a+)*',
    ]) {
      expect(hasNestedRepeat(pattern)).toBe(true);
    }
  });

  it('accepts ordinary patterns', () => {
    for (const pattern of [
      'amazon',
      '^(amazon|amzn)\\b',
      '(foo|bar)+',
      '[a+]+',
      '\\(a+\\)+',
      'a+b*c?',
      '(abc)?',
      '(\\d{4})-(\\d{2})',
      '(a+)?',
      '(ab){2}',
      '(a?)+',
      '.*coffee.*',
    ]) {
      expect(hasNestedRepeat(pattern)).toBe(false);
    }
  });
});
