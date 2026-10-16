import { hasNestedRepeat } from '#shared/regex-safety';

export function regexp(regex: string, text: string | null) {
  // A nested repeat such as (a+)+$ backtracks exponentially on long text and
  // would stall the query, so it matches nothing, as in rule conditions.
  if (hasNestedRepeat(regex)) {
    return 0;
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(regex);
  } catch {
    // An invalid pattern, such as one still being typed into a rule
    // condition, matches nothing instead of failing the whole query. This
    // is how `matches` conditions already behave when evaluated in memory.
    return 0;
  }
  return pattern.test(text || '') ? 1 : 0;
}
