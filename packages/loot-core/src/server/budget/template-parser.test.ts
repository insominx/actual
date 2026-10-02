import { parseTemplateNote } from './template-parser';

describe('parseTemplateNote', () => {
  it.each([
    {
      description: 'parses a simple template',
      note: '#template 10',
      expected: [
        {
          type: 'simple',
          monthly: 10,
          limit: null,
          priority: 0,
          directive: 'template',
        },
      ],
    },
    {
      description: 'parses a negative simple template',
      note: '#template -103.23',
      expected: [
        {
          type: 'simple',
          monthly: -103.23,
          limit: null,
          priority: 0,
          directive: 'template',
        },
      ],
    },
    {
      description: 'parses a template after a line prefix',
      note: 'test: #template 12',
      expected: [
        {
          type: 'simple',
          monthly: 12,
          limit: null,
          priority: 0,
          directive: 'template',
        },
      ],
    },
    {
      description: 'parses a goal directive',
      note: '#goal 10',
      expected: [
        { type: 'goal', amount: 10, priority: null, directive: 'goal' },
      ],
    },
    {
      description: 'returns nothing for an empty note',
      note: '',
      expected: [],
    },
    {
      description: 'returns nothing for a note without directives',
      note: 'Not a template note',
      expected: [],
    },
    {
      description: 'captures a multi-line description above a template',
      note: 'Line one\nLine two\n#template 10',
      expected: [
        {
          type: 'simple',
          monthly: 10,
          limit: null,
          priority: 0,
          directive: 'template',
          description: 'Line one\nLine two',
        },
      ],
    },
    {
      description: 'ignores prose separated by a blank line',
      note: 'Just a note\n\n#template 10',
      expected: [
        {
          type: 'simple',
          monthly: 10,
          limit: null,
          priority: 0,
          directive: 'template',
        },
      ],
    },
    {
      description: 'only attaches a description to the template directly below',
      note: 'Groceries\n#template 10\n#template-2 20',
      expected: [
        {
          type: 'simple',
          monthly: 10,
          limit: null,
          priority: 0,
          directive: 'template',
          description: 'Groceries',
        },
        {
          type: 'simple',
          monthly: 20,
          limit: null,
          priority: 2,
          directive: 'template',
        },
      ],
    },
    {
      description: 'parses a schedule template',
      note: '#template schedule Insurance',
      expected: [
        {
          type: 'schedule',
          name: 'Insurance',
          priority: 0,
          directive: 'template',
          full: null,
          adjustment: undefined,
          adjustmentType: undefined,
        },
      ],
    },
    {
      description: 'parses a repeating by template',
      note: '#template 600 by 2026-08 repeat every year',
      expected: [
        {
          type: 'by',
          amount: 600,
          month: '2026-08',
          annual: true,
          from: null,
          priority: 0,
          directive: 'template',
        },
      ],
    },
  ])('$description', ({ note, expected }) => {
    expect(parseTemplateNote(note)).toEqual(expected);
  });

  it('turns an unparseable line into an error template', () => {
    expect(parseTemplateNote('#template broken template')).toEqual([
      {
        type: 'error',
        directive: 'error',
        line: '#template broken template',
        error: expect.any(String),
      },
    ]);
  });

  it('rejects an out-of-range schedule adjustment', () => {
    expect(
      parseTemplateNote('#template schedule Rent [increase 1001%]'),
    ).toEqual([
      {
        type: 'error',
        directive: 'error',
        line: '#template schedule Rent [increase 1001%]',
        error:
          'Invalid adjustment percentage (1001%). Must be between -100% and 1000%',
      },
    ]);
  });

  it('keeps the description on an error template', () => {
    expect(parseTemplateNote('Broken\n#template broken template')).toEqual([
      expect.objectContaining({ type: 'error', description: 'Broken' }),
    ]);
  });
});
