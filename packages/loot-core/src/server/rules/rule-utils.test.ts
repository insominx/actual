import { Rule } from './rule';
import { lowerCaseRegexSource, migrateIds } from './rule-utils';

describe('lowerCaseRegexSource', () => {
  it('lowercases literal characters', () => {
    expect(lowerCaseRegexSource('^Coffee [A-Z]+$')).toBe('^coffee [a-z]+$');
  });

  it('leaves escape sequences untouched', () => {
    expect(lowerCaseRegexSource('\\S+\\D\\W\\B')).toBe('\\S+\\D\\W\\B');
    expect(lowerCaseRegexSource('Foo\\.Bar')).toBe('foo\\.bar');
  });

  it('leaves property names and named groups untouched', () => {
    expect(lowerCaseRegexSource('\\p{Lu}X')).toBe('\\p{Lu}x');
    expect(lowerCaseRegexSource('(?<Word>A)\\k<Word>')).toBe(
      '(?<Word>a)\\k<Word>',
    );
    // Lookbehind is not a named group
    expect(lowerCaseRegexSource('(?<!A)B')).toBe('(?<!a)b');
  });

  it('handles a trailing backslash', () => {
    expect(lowerCaseRegexSource('A\\')).toBe('a\\');
  });
});

describe('migrateIds', () => {
  it('deduplicates mapped IDs in oneOf and notOneOf conditions', () => {
    const rule = new Rule({
      conditionsOp: 'and',
      conditions: [
        {
          op: 'oneOf',
          field: 'payee',
          value: ['payee-a', 'payee-b', 'payee-c'],
          options: null,
        },
        {
          op: 'notOneOf',
          field: 'payee',
          value: ['payee-a', 'payee-b', 'payee-c'],
          options: null,
        },
      ],
      actions: [],
    });
    const mappings = new Map([
      ['payee-a', 'payee-merged'],
      ['payee-b', 'payee-merged'],
    ]);

    migrateIds(rule, mappings);

    expect(rule.conditions[0].rawValue).toEqual([
      'payee-a',
      'payee-b',
      'payee-c',
    ]);
    expect(rule.conditions[0].value).toEqual(['payee-merged', 'payee-c']);
    expect(rule.conditions[0].unparsedValue).toEqual([
      'payee-merged',
      'payee-c',
    ]);
    expect(rule.conditions[1].rawValue).toEqual([
      'payee-a',
      'payee-b',
      'payee-c',
    ]);
    expect(rule.conditions[1].value).toEqual(['payee-merged', 'payee-c']);
    expect(rule.conditions[1].unparsedValue).toEqual([
      'payee-merged',
      'payee-c',
    ]);
  });
});
