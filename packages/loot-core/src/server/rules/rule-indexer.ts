// @ts-strict-ignore
import { fastSetMerge } from '#shared/util';

import type { Rule } from './rule';

export class RuleIndexer {
  field: string;
  method?: string;
  rules: Map<string, Set<Rule>>;

  constructor({ field, method }: { field: string; method?: string }) {
    this.field = field;
    this.method = method;
    this.rules = new Map();
  }

  getIndex(key: string | null): Set<Rule> {
    if (!this.rules.has(key)) {
      this.rules.set(key, new Set());
    }
    return this.rules.get(key);
  }

  getIndexForValue(value: unknown): Set<Rule> {
    return this.getIndex(this.getKey(value) || '*');
  }

  getKey(value: unknown): string | null {
    if (typeof value === 'string' && value !== '') {
      if (this.method === 'firstchar') {
        // Lowercase before taking the first char, exactly like condition
        // values are lowercased whole (lowercasing can change the length)
        return value.toLowerCase()[0];
      }
      return value.toLowerCase();
    }
    return null;
  }

  getIndexes(rule: Rule): Set<Rule>[] {
    const isNarrowing = cond =>
      cond.field === this.field && (cond.op === 'oneOf' || cond.op === 'is');

    // Only `is`/`oneOf` restrict a rule to specific values. Negative
    // operators match everything except their value, and an `or` rule can
    // match through any other condition, so those must always be run.
    if (
      rule.conditionsOp === 'or' &&
      !(rule.conditions.length > 0 && rule.conditions.every(isNarrowing))
    ) {
      return [this.getIndex('*')];
    }

    // An `and` rule only runs when its first narrowing condition matches;
    // an all-narrowing `or` rule runs when any of its conditions matches.
    const conds =
      rule.conditionsOp === 'or'
        ? rule.conditions
        : rule.conditions.filter(isNarrowing).slice(0, 1);
    const indexes = [];

    for (const cond of conds) {
      if (cond.op === 'oneOf') {
        cond.value.forEach(val => indexes.push(this.getIndexForValue(val)));
      } else {
        indexes.push(this.getIndexForValue(cond.value));
      }
    }
    if (conds.length === 0) {
      indexes.push(this.getIndex('*'));
    }

    return indexes;
  }

  index(rule: Rule): void {
    const indexes = this.getIndexes(rule);
    indexes.forEach(index => {
      index.add(rule);
    });
  }

  remove(rule: Rule): void {
    const indexes = this.getIndexes(rule);
    indexes.forEach(index => {
      index.delete(rule);
    });
  }

  getApplicableRules(object): Set<Rule> {
    let indexedRules;
    if (this.field in object) {
      const key = this.getKey(object[this.field]);
      if (key) {
        indexedRules = this.rules.get(key);
      }
    }

    return fastSetMerge(
      indexedRules || new Set(),
      this.rules.get('*') || new Set(),
    );
  }
}
