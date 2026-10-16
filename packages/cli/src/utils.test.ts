import { AgentError } from './agent-output';
import {
  errorMessage,
  parseBoolFlag,
  parseIntFlag,
  plainInteger,
} from './utils';

describe('parseBoolFlag', () => {
  it('parses "true"', () => {
    expect(parseBoolFlag('true', '--flag')).toBe(true);
  });

  it('parses "false"', () => {
    expect(parseBoolFlag('false', '--flag')).toBe(false);
  });

  it('rejects other strings', () => {
    expect(() => parseBoolFlag('yes', '--flag')).toThrow(
      'Invalid --flag: "yes". Expected "true" or "false".',
    );
  });

  it('includes the flag name in the error message', () => {
    expect(() => parseBoolFlag('1', '--offbudget')).toThrow(
      'Invalid --offbudget',
    );
  });
});

describe('parseIntFlag', () => {
  it('parses a valid integer string', () => {
    expect(parseIntFlag('42', '--balance')).toBe(42);
  });

  it('parses zero', () => {
    expect(parseIntFlag('0', '--balance')).toBe(0);
  });

  it('parses negative integers', () => {
    expect(parseIntFlag('-10', '--balance')).toBe(-10);
  });

  it('rejects decimal values', () => {
    expect(() => parseIntFlag('3.5', '--balance')).toThrow(
      'Invalid --balance: "3.5". Expected an integer.',
    );
  });

  it('rejects non-numeric strings', () => {
    expect(() => parseIntFlag('abc', '--balance')).toThrow(
      'Invalid --balance: "abc". Expected an integer.',
    );
  });

  it('rejects partially numeric strings', () => {
    expect(() => parseIntFlag('3abc', '--balance')).toThrow(
      'Invalid --balance: "3abc". Expected an integer.',
    );
  });

  it('rejects empty string', () => {
    expect(() => parseIntFlag('', '--balance')).toThrow(
      'Invalid --balance: "". Expected an integer.',
    );
  });

  it('includes the flag name in the error message', () => {
    expect(() => parseIntFlag('x', '--amount')).toThrow('Invalid --amount');
  });
});

describe('errorMessage', () => {
  it('reads Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('reads the engine plain-object APIError instead of [object Object]', () => {
    expect(
      errorMessage({ type: 'APIError', message: 'Import file changed' }),
    ).toBe('Import file changed');
  });

  it('falls back to String for other values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ message: 1 })).toBe('[object Object]');
  });
});

describe('plain integer parsing', () => {
  it.each(['0x10', '0b11', '0o7', '1e3', '1.0', '', ' ', '--5', '5 5', '١٢'])(
    'refuses %j',
    value => {
      expect(Number.isNaN(plainInteger(value))).toBe(true);
      expect(() => parseIntFlag(value, '--amount')).toThrow(AgentError);
    },
  );

  it.each([
    ['7', 7],
    [' 7 ', 7],
    ['-5', -5],
    ['+5', 5],
    ['007', 7],
  ])('accepts %j', (value, expected) => {
    expect(plainInteger(value)).toBe(expected);
    expect(parseIntFlag(value, '--amount')).toBe(expected);
  });
});
