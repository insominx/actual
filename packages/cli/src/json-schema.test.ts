import { describe, expect, it } from 'vitest';

import { operationPayloadSchema, validateJson } from './json-schema';

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
