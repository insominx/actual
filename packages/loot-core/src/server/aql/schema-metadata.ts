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
