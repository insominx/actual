export type Mappings = Map<string, Map<string, string>>;

export const mappingsToString = (mapping: Mappings): string =>
  JSON.stringify(
    Object.fromEntries(
      [...mapping.entries()].map(([key, value]) => [
        key,
        Object.fromEntries(value),
      ]),
    ),
  );

export const mappingsFromString = (str: string): Mappings => {
  try {
    const parsed = JSON.parse(str);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('Invalid mapping format');
    }
    return new Map(
      Object.entries(parsed).map(([key, value]) => {
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          throw new Error('Invalid mapping format');
        }
        return [key, new Map(Object.entries(value as Record<string, string>))];
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : e;
    throw new Error(`Failed to parse mapping: ${String(message)}`);
  }
};

export const defaultMappings: Mappings = new Map([
  [
    'payment',
    new Map([
      ['date', 'date'],
      ['payee', 'payeeName'],
      ['notes', 'notes'],
    ]),
  ],
  [
    'deposit',
    new Map([
      ['date', 'date'],
      ['payee', 'payeeName'],
      ['notes', 'notes'],
    ]),
  ],
]);
