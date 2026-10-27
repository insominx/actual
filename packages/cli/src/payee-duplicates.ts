// Groups payees whose names differ only by the noise banks add to a merchant
// name: card-processor prefixes (SQ *, TST*), store numbers, reference codes,
// padded city/state/country columns and zip codes. Read-only: the result
// suggests merges for `payees merge`, it never changes anything.

const PROCESSOR_PREFIX =
  /^(?:sq|sqc|tst|sp|py|pp|dd|ls|wl|tm|ic|bt|fs|fsp|cke|uep|spo|par|paypal|pos)\s*\*+\s*/;
const NOISE = [
  /\s{2,}\S.*$/, // padded columns: "MERCHANT     CITY     ST"
  /\b\d{5}\b.*$/, // zip code and everything after it
  /#\s*\d+.*$/, // store numbers
  /\b(?:usa|us|united states|ca|ny|wa|tx|or|nv|tn|fl)\.?$/,
  /\b[a-z]*\d[a-z\d]{4,}\b/g, // reference codes containing digits
  /\b\d{3,}\b/g,
  /[^a-z0-9&' ]+/g,
];
const FILLER = /\b(?:inc|llc|co|corp|the|com|www)\b/g;

export function payeeKey(name: string): string {
  let key = name.toLowerCase().trim().replace(PROCESSOR_PREFIX, '');
  for (const pattern of NOISE) {
    key = key.replace(pattern, ' ').trim();
  }
  return key.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
}

export type DuplicatePayee = {
  id: string;
  name: string;
  transactionCount: number;
};

export type DuplicatePayeeGroup = {
  key: string;
  target: DuplicatePayee;
  merge: DuplicatePayee[];
  transactionCount: number;
};

function tokens(key: string) {
  return key.split(' ').filter(Boolean);
}

// A key absorbs longer keys that start with all of its tokens, so
// "ambrosia india bistro" also groups "ambrosia india bistro monterey". Short
// keys are not used as prefixes: "zelle payment" would swallow every payee.
function canAbsorb(prefix: string) {
  return tokens(prefix).length >= 2 && prefix.length >= 8;
}

export function findDuplicatePayees(
  payees: DuplicatePayee[],
  { minKeyLength = 4 } = {},
): DuplicatePayeeGroup[] {
  const byKey = new Map<string, DuplicatePayee[]>();
  for (const payee of payees) {
    const key = payeeKey(payee.name);
    if (key.length < minKeyLength) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), payee]);
  }
  const keys = [...byKey.keys()].sort((a, b) => a.length - b.length);
  const owner = new Map<string, string>();
  for (const key of keys) {
    const parent = keys.find(
      other =>
        other !== key &&
        canAbsorb(other) &&
        (key + ' ').startsWith(other + ' ') &&
        !owner.has(other),
    );
    if (parent) owner.set(key, parent);
  }
  const groups = new Map<string, DuplicatePayee[]>();
  for (const [key, members] of byKey) {
    const root = owner.get(key) ?? key;
    groups.set(root, [...(groups.get(root) ?? []), ...members]);
  }
  return [...groups]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      const sorted = [...members].sort(
        (a, b) =>
          b.transactionCount - a.transactionCount ||
          a.name.length - b.name.length ||
          a.id.localeCompare(b.id),
      );
      return {
        key,
        target: sorted[0],
        merge: sorted.slice(1),
        transactionCount: sorted.reduce(
          (sum, payee) => sum + payee.transactionCount,
          0,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.merge.length - a.merge.length ||
        b.transactionCount - a.transactionCount ||
        a.key.localeCompare(b.key),
    );
}
