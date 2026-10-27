// Read-only rule drift check: run existing transactions through the current
// rules as an import would and report those whose category or payee the rules
// would set differently. The sample carries the stored category and payee, so a
// field no rule touches comes back unchanged and is not reported.

export type CheckedTransaction = {
  id: string;
  account: string;
  date: string;
  amount: number;
  imported_payee: string | null;
  payee: string | null;
  notes: string | null;
  category: string | null;
};

export type RuleTestResult = {
  result?: { category?: string | null; payee?: string | null } | null;
  appliedRules?: Array<{ id: string }>;
};

export const RULE_CHECK_LIMIT = 5000;

export function ruleSample(row: CheckedTransaction) {
  return {
    account: row.account,
    date: row.date,
    amount: row.amount,
    imported_payee: row.imported_payee ?? undefined,
    payee: row.payee ?? undefined,
    notes: row.notes ?? undefined,
    category: row.category ?? undefined,
  };
}

// `rules` is the number of rules the check ran against, so an empty `drifted`
// list from a budget without rules is not mistaken for a clean result.
export function ruleDrift(
  rows: CheckedTransaction[],
  results: Array<RuleTestResult | { error: string }>,
  rules: number,
) {
  const drifted = [];
  const errors = [];
  for (const [index, row] of rows.entries()) {
    const outcome = results[index];
    if (!outcome || 'error' in outcome) {
      errors.push({ id: row.id, error: outcome?.error ?? 'no result' });
      continue;
    }
    const category = outcome.result?.category ?? null;
    const payee = outcome.result?.payee ?? null;
    if (category !== (row.category ?? null) || payee !== (row.payee ?? null)) {
      drifted.push({
        id: row.id,
        date: row.date,
        amount: row.amount,
        importedPayee: row.imported_payee,
        current: { category: row.category ?? null, payee: row.payee ?? null },
        rules: { category, payee },
        appliedRules: (outcome.appliedRules ?? []).map(rule => rule.id),
      });
    }
  }
  return { checked: rows.length, rules, drifted, errors };
}
