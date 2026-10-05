// Read-only query metadata derived from the AQL schema and compiler. This is
// the single source for agent-facing table, field and operator discovery.
import type { QueryState } from '#shared/query';

import {
  AQL_FILTER_OPERATORS,
  AQL_FUNCTIONS,
  AQL_LOGICAL_OPERATORS,
  compileQuery,
  isAggregateQuery,
} from './compiler';
import { schema, schemaConfig } from './schema';

export type QueryFieldMetadata = {
  name: string;
  type: string;
  ref?: string;
  required: boolean;
};

export type QueryTableMetadata = {
  name: string;
  fields: QueryFieldMetadata[];
};

export type QuerySchemaMetadata = {
  tables: QueryTableMetadata[];
  filterOperators: string[];
  logicalOperators: string[];
  functions: string[];
};

export type QueryValidation =
  | { valid: true; table: string; aggregate: boolean }
  | { valid: false; table: string | null; message: string };

export function describeQuerySchema(): QuerySchemaMetadata {
  const tables = Object.entries(
    schema as Record<
      string,
      Record<string, { type: string; ref?: string; required?: boolean }>
    >,
  ).map(([name, fields]) => ({
    name,
    fields: Object.entries(fields).map(([field, info]) => ({
      name: field,
      type: info.type,
      ...(info.ref ? { ref: info.ref } : {}),
      required: info.required === true,
    })),
  }));
  return {
    tables,
    filterOperators: [...AQL_FILTER_OPERATORS],
    logicalOperators: [...AQL_LOGICAL_OPERATORS],
    functions: [...AQL_FUNCTIONS],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

// The compiler applies only the first operator of a condition object, so
// `{ date: { $gte: a, $lte: b } }` would silently drop the second bound.
function findMultiOperatorCondition(expr: unknown): string | null {
  if (Array.isArray(expr)) {
    for (const item of expr) {
      const found = findMultiOperatorCondition(item);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(expr)) return null;
  for (const [field, cond] of Object.entries(expr)) {
    if (field === '$and' || field === '$or') {
      const found = findMultiOperatorCondition(cond);
      if (found) return found;
      continue;
    }
    const ops = Array.isArray(cond) ? cond : [cond];
    for (const op of ops) {
      if (
        isPlainObject(op) &&
        Object.keys(op).filter(key => key !== '$transform').length > 1
      ) {
        return field;
      }
    }
  }
  return null;
}

// Compiles without executing, so unknown tables, fields, paths, operators and
// functions are reported before any database access.
export function validateQuery(queryState: QueryState): QueryValidation {
  const table =
    queryState && typeof queryState.table === 'string'
      ? queryState.table
      : null;
  if (!table || !(table in schema)) {
    return {
      valid: false,
      table,
      message: table
        ? `Table "${table}" does not exist in the schema`
        : 'Query must name a table',
    };
  }
  const multi = findMultiOperatorCondition(queryState.filterExpressions);
  if (multi) {
    return {
      valid: false,
      table,
      message: `The condition for "${multi}" has several operators, but only the first would apply. Use $and with one operator per condition.`,
    };
  }
  try {
    compileQuery(queryState, schema, schemaConfig);
    return {
      valid: true,
      table,
      aggregate:
        queryState.calculation === true || isAggregateQuery(queryState),
    };
  } catch (error) {
    return {
      valid: false,
      table,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
