import type { Command, Option } from 'commander';

import { AgentError } from './agent-output';
import { DIRECT_GUARDED_COMMANDS } from './guarded-operations';
import { operationPayloadSchema } from './json-schema';
import type { JsonSchema } from './json-schema';

type PropertySchema = {
  type: 'string' | 'integer' | 'boolean';
  description: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
};

const INTEGERS = new Set([
  'amount',
  'balance',
  'limit',
  'offset',
  'last',
  'cacheTtl',
  'lockTimeout',
  'port',
  'interval',
  'timeout',
  'samples',
  'retries',
  'keep',
]);
const NONNEGATIVE = new Set([
  'limit',
  'offset',
  'last',
  'cacheTtl',
  'lockTimeout',
]);
const DATES = new Set(['start', 'end', 'cutoff']);
const MONTHS = new Set(['month']);
const BOOLEANS = new Set(['offbudget', 'hidden', 'carryover']);
const WATCH_RANGES: Record<string, { minimum: number; maximum: number }> = {
  interval: { minimum: 1, maximum: 300 },
  timeout: { minimum: 1, maximum: 120 },
  samples: { minimum: 1, maximum: 1000 },
  retries: { minimum: 0, maximum: 20 },
};
const READ_OPERATIONS = new Set([
  'changes.preview',
  'changes.status',
  'budgets.inspect',
  'budgets.compare',
  'backups.validate',
  'sync.status',
  'sync.refresh',
  'sync.watch',
  'budgets.download',
  'query.run',
  'query.tables',
  'query.fields',
  'query.resolve',
  'server.version',
  'server.get-id',
  'rules.payee-rules',
  'payees.common',
  'capabilities',
  'schema',
  'context',
  'doctor',
  'connection.test',
  'server.status',
  'server.logs',
  'profiles.list',
  'profiles.show',
]);

export function operationName(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join('.');
}

function optionSchema(option: Option, operation?: string): PropertySchema {
  const name = option.attributeName();
  const bounds =
    name === 'limit' && operation === 'changes.list'
      ? { minimum: 1, maximum: 500 }
      : (name === 'keep' && operation === 'backups.prune') ||
          (name === 'limit' &&
            ['budgets.compare', 'backups.prune', 'backups.list'].includes(
              operation ?? '',
            ))
        ? { minimum: 1, maximum: 1000 }
        : WATCH_RANGES[name];
  const type = INTEGERS.has(name)
    ? 'integer'
    : !option.required && !option.optional
      ? 'boolean'
      : BOOLEANS.has(name)
        ? 'boolean'
        : 'string';
  return {
    type,
    description: option.description,
    ...(option.argChoices ? { enum: option.argChoices } : {}),
    ...(type === 'integer'
      ? {
          minimum:
            bounds?.minimum ??
            (NONNEGATIVE.has(name) ? 0 : Number.MIN_SAFE_INTEGER),
          maximum: bounds?.maximum ?? Number.MAX_SAFE_INTEGER,
        }
      : {}),
    ...(DATES.has(name)
      ? { format: 'date' }
      : MONTHS.has(name)
        ? { format: 'year-month' }
        : {}),
  };
}

export function discoverOperations(root: Command) {
  const result: Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      additionalProperties: false;
      properties: Record<string, PropertySchema>;
      required: string[];
    };
    arguments: Array<{
      name: string;
      required: boolean;
      variadic: boolean;
      description: string;
    }>;
    capabilities: {
      mutates: boolean;
      preview: false;
      reversal: false;
      destructive: boolean;
    };
    examples: string[];
    payloadSchema?: JsonSchema;
    globalOptions: Record<string, PropertySchema>;
  }> = [];
  function visit(command: Command) {
    if (command.commands.length) {
      command.commands.forEach(visit);
      return;
    }
    const name = operationName(command);
    const verb = command.name();
    const mutates =
      !READ_OPERATIONS.has(name) &&
      !['list', 'balance', 'months', 'month'].includes(verb);
    result.push({
      name,
      description: command.description(),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          command.options.map(o => [o.attributeName(), optionSchema(o, name)]),
        ),
        required: [
          ...command.options
            .filter(o => o.mandatory)
            .map(o => o.attributeName()),
          ...(DIRECT_GUARDED_COMMANDS.includes(name) ? ['operationId'] : []),
        ],
      },
      arguments: command.registeredArguments.map(a => ({
        name: a.name(),
        required: a.required,
        variadic: a.variadic,
        description: a.description,
      })),
      capabilities: {
        mutates,
        preview: false,
        reversal: false,
        destructive: ['delete', 'merge', 'close', 'prune'].includes(verb),
      },
      examples: [`actual ${name.replaceAll('.', ' ')} --help`],
      globalOptions: Object.fromEntries(
        root.options.map(o => [o.attributeName(), optionSchema(o)]),
      ),
      ...(operationPayloadSchema(name)
        ? { payloadSchema: operationPayloadSchema(name) }
        : {}),
    });
  }
  root.commands.forEach(visit);
  return result;
}

export function validateCommandInput(
  command: Command,
  options: Record<string, unknown>,
) {
  for (const option of command.options) {
    const name = option.attributeName();
    const value = options[name];
    if (value === undefined) continue;
    if (INTEGERS.has(name)) {
      const number =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim()
            ? Number(value)
            : NaN;
      if (
        !Number.isSafeInteger(number) ||
        (NONNEGATIVE.has(name) && number < 0)
      ) {
        throw new AgentError(
          'INVALID_INPUT',
          `Invalid --${option.long?.slice(2) ?? name}: expected ${NONNEGATIVE.has(name) ? 'a nonnegative' : 'a safe'} integer.`,
          false,
          { field: name },
        );
      }
    }
    if (
      DATES.has(name) &&
      (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Expected a valid YYYY-MM-DD date.',
        false,
        { field: name },
      );
    }
    if (
      MONTHS.has(name) &&
      (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Expected a valid YYYY-MM month.',
        false,
        { field: name },
      );
    }
    if (name === 'name' && (typeof value !== 'string' || !value.trim())) {
      throw new AgentError(
        'INVALID_INPUT',
        'Expected a nonempty name.',
        false,
        { field: name },
      );
    }
    if (
      BOOLEANS.has(name) &&
      value !== true &&
      value !== false &&
      value !== 'true' &&
      value !== 'false'
    ) {
      throw new AgentError('INVALID_INPUT', 'Expected true or false.', false, {
        field: name,
      });
    }
  }
  for (let i = 0; i < command.registeredArguments.length; i++) {
    if (
      command.registeredArguments[i].name() === 'month' &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(command.processedArgs[i]))
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Expected a valid YYYY-MM month.',
        false,
        { field: 'month' },
      );
    }
  }
}
