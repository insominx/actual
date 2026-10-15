import { describe, expect, it } from 'vitest';

import { operationPayloadSchema, validateJson } from './json-schema';
import { MAX_ENGINE_AMOUNT, parseIntFlag } from './utils';

describe('validateJson additionalProperties', () => {
  const schema = operationPayloadSchema('schedules.update')!;

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'rejects the inherited name %s as an unknown field',
    key => {
      const payload = JSON.parse(`{"${key}": "x"}`);
      expect(() => validateJson(payload, schema)).toThrow(/Unknown JSON field/);
    },
  );

  it('still accepts declared fields', () => {
    expect(() => validateJson({ name: 'Rent' }, schema)).not.toThrow();
  });

  it('rejects an unknown transaction row field named constructor', () => {
    const rows = JSON.parse(
      '[{"date":"2026-09-20","amount":100,"constructor":"x"}]',
    );
    expect(() =>
      validateJson(rows, operationPayloadSchema('changes.preview')!),
    ).toThrow();
  });
});

describe('amount limit', () => {
  const rows = (amount: number) => [{ date: '2026-09-20', amount }];
  const schema = () => operationPayloadSchema('changes.preview')!;

  it('accepts amounts up to the budget engine limit', () => {
    expect(() => validateJson(rows(MAX_ENGINE_AMOUNT), schema())).not.toThrow();
    expect(() =>
      validateJson(rows(-MAX_ENGINE_AMOUNT), schema()),
    ).not.toThrow();
  });

  // Between 2**51 and 2**53 the amount is a JS safe integer, but the
  // spreadsheet's safeNumber rejects every sum that includes it.
  it.each([2 ** 51, 2 ** 52, Number.MAX_SAFE_INTEGER, -(2 ** 51)])(
    'rejects %s',
    amount => {
      expect(() => validateJson(rows(amount), schema())).toThrow();
      expect(() => parseIntFlag(String(amount), '--amount')).toThrow();
    },
  );
});
