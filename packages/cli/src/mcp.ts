// Optional MCP adapter: a stdio JSON-RPC server (newline-delimited, the MCP
// stdio transport) that exposes the CLI's registered operations as explicit
// domain tools. Tool schemas come from discoverOperations (the same registry
// as `actual capabilities`). Each call runs the CLI itself as a child process
// with version 2 output, so MCP results are the CLI's results, executed by
// the same operation path, locks, journals and run records. Protocol frames
// are the only thing written to stdout; diagnostics go to stderr.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { Command, Option } from 'commander';

import { discoverOperations, operationName } from './agent-contract';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Long-running, interactive, lifecycle and credential-handling commands are
// not tools; run them from a shell.
const EXCLUDED = [
  /^mcp(\.|$)/,
  /^server\.(init|start|stop|logs|bootstrap)$/,
  /^sync\.watch$/,
  /^profiles\.(set|use)$/,
];

type Operation = ReturnType<typeof discoverOperations>[number];

export type McpTool = {
  name: string;
  operation: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    additionalProperties: false;
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

type ToolBinding = {
  tool: McpTool;
  path: string[];
  positionals: Array<{ property: string; variadic: boolean }>;
  options: Option[];
};

function camel(name: string) {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function toolName(operation: string) {
  // Operation names use letters, digits, hyphens and dots; tool names swap
  // dots for underscores, which operation names never contain.
  return operation.replaceAll('.', '_');
}

function leafCommands(root: Command) {
  const leaves = new Map<string, Command>();
  const visit = (command: Command) => {
    if (command.commands.length) {
      command.commands.forEach(visit);
      return;
    }
    leaves.set(operationName(command), command);
  };
  root.commands.forEach(visit);
  return leaves;
}

export function buildTools(root: Command, domains?: string[]) {
  const leaves = leafCommands(root);
  const bindings = new Map<string, ToolBinding>();
  for (const operation of discoverOperations(root) as Operation[]) {
    if (EXCLUDED.some(pattern => pattern.test(operation.name))) continue;
    const domain = operation.name.split('.')[0];
    if (domains && !domains.includes(domain)) continue;
    const command = leaves.get(operation.name);
    if (!command) continue;
    const properties: Record<string, Record<string, unknown>> = {
      ...operation.inputSchema.properties,
    };
    const required = [...operation.inputSchema.required];
    const positionals = operation.arguments.map(argument => {
      let property = camel(argument.name);
      if (property in properties) {
        property = `arg${property[0].toUpperCase()}${property.slice(1)}`;
      }
      properties[property] = argument.variadic
        ? {
            type: 'array',
            items: { type: 'string' },
            description: argument.description || `Positional ${argument.name}`,
          }
        : {
            type: 'string',
            description: argument.description || `Positional ${argument.name}`,
          };
      if (argument.required) required.push(property);
      return { property, variadic: argument.variadic };
    });
    const tool: McpTool = {
      name: toolName(operation.name),
      operation: operation.name,
      title: `actual ${operation.name.replaceAll('.', ' ')}`,
      description: operation.description,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties,
        required: [...new Set(required)],
      },
      annotations: {
        readOnlyHint: !operation.capabilities.mutates,
        destructiveHint: operation.capabilities.destructive,
        idempotentHint: !operation.capabilities.mutates,
        openWorldHint: false,
      },
    };
    bindings.set(tool.name, {
      tool,
      path: operation.name.split('.'),
      positionals,
      options: command.options as Option[],
    });
  }
  return bindings;
}

export class ToolInputError extends Error {}

// Validates tool input against the generated schema before anything runs,
// then maps it onto CLI arguments.
export function toolArgv(binding: ToolBinding, input: unknown): string[] {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ToolInputError('Tool arguments must be an object.');
  }
  const values = input as Record<string, unknown>;
  const schema = binding.tool.inputSchema;
  for (const key of Object.keys(values)) {
    if (!(key in schema.properties)) {
      throw new ToolInputError(`Unknown argument "${key}".`);
    }
  }
  for (const key of schema.required) {
    if (values[key] === undefined) {
      throw new ToolInputError(`Missing required argument "${key}".`);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const type = schema.properties[key].type;
    const ok =
      type === 'boolean'
        ? typeof value === 'boolean'
        : type === 'integer'
          ? Number.isSafeInteger(value)
          : type === 'array'
            ? Array.isArray(value) && value.every(v => typeof v === 'string')
            : typeof value === 'string';
    if (!ok) {
      throw new ToolInputError(`Argument "${key}" must be ${String(type)}.`);
    }
  }
  const argv = [...binding.path];
  for (const positional of binding.positionals) {
    const value = values[positional.property];
    if (value === undefined) continue;
    if (Array.isArray(value)) argv.push(...(value as string[]));
    else argv.push(String(value));
  }
  const seen = new Set<string>();
  for (const option of binding.options) {
    const name = option.attributeName();
    if (seen.has(name)) continue;
    const value = values[name];
    if (value === undefined) continue;
    seen.add(name);
    const variants = binding.options.filter(o => o.attributeName() === name);
    const flag = (wantNegate: boolean) =>
      variants.find(o => o.negate === wantNegate)?.long;
    if (typeof value === 'boolean') {
      const takesValue = variants.some(o => o.required || o.optional);
      if (takesValue) {
        argv.push(flag(false) ?? `--${name}`, String(value));
        continue;
      }
      const long = flag(!value);
      if (long) argv.push(long);
      continue;
    }
    argv.push(flag(false) ?? option.long ?? `--${name}`, String(value));
  }
  return argv;
}

type JsonRpcId = string | number;

type Request = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type ServeOptions = {
  root: Command;
  domains?: string[];
  globalArgs: string[];
  cliEntry: string;
  version: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

const RESOURCES = [
  {
    uri: 'actual://domains',
    name: 'domains',
    description: 'Tool domains with their tools and read/write counts',
    mimeType: 'application/json',
  },
  {
    uri: 'actual://operations',
    name: 'operations',
    description: 'The full operation registry (same as actual capabilities)',
    mimeType: 'application/json',
  },
];

export function serveMcp(options: ServeOptions): Promise<void> {
  const output = options.output ?? process.stdout;
  const bindings = buildTools(options.root, options.domains);
  const running = new Map<JsonRpcId, ChildProcess>();
  const send = (message: Record<string, unknown>) => {
    output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const reply = (id: JsonRpcId, result: unknown) => send({ id, result });
  const fail = (id: JsonRpcId | null, code: number, message: string) =>
    send({ id, error: { code, message } });

  function domains() {
    const byDomain = new Map<
      string,
      { tools: string[]; reads: number; writes: number }
    >();
    for (const { tool } of bindings.values()) {
      const domain = tool.operation.split('.')[0];
      const entry = byDomain.get(domain) ?? { tools: [], reads: 0, writes: 0 };
      entry.tools.push(tool.name);
      if (tool.annotations.readOnlyHint) entry.reads++;
      else entry.writes++;
      byDomain.set(domain, entry);
    }
    return Object.fromEntries(byDomain);
  }

  function callTool(id: JsonRpcId, params: Record<string, unknown>) {
    const name = params.name;
    const binding = typeof name === 'string' ? bindings.get(name) : undefined;
    if (!binding) {
      fail(id, -32602, `Unknown tool: ${String(name)}`);
      return;
    }
    let argv: string[];
    try {
      argv = toolArgv(binding, params.arguments);
    } catch (error) {
      fail(
        id,
        -32602,
        error instanceof Error ? error.message : 'Invalid arguments.',
      );
      return;
    }
    const child = spawn(
      process.execPath,
      [
        options.cliEntry,
        ...options.globalArgs,
        '--output-version',
        '2',
        ...argv,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    running.set(id, child);
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.on('close', code => {
      if (!running.has(id)) return; // Cancelled: no response is sent.
      running.delete(id);
      let structured: unknown = null;
      try {
        structured = JSON.parse(stdout);
      } catch {
        structured = null;
      }
      reply(id, {
        content: [{ type: 'text', text: stdout.trim() }],
        ...(structured && typeof structured === 'object'
          ? { structuredContent: structured }
          : {}),
        isError: code !== 0,
      });
    });
  }

  function handle(message: Request) {
    const { id, method, params = {} } = message;
    if (id === undefined) {
      if (method === 'notifications/cancelled') {
        const target = params.requestId as JsonRpcId | undefined;
        const child = target === undefined ? undefined : running.get(target);
        if (child) {
          running.delete(target as JsonRpcId);
          child.kill('SIGTERM');
        }
      }
      return;
    }
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        reply(id, {
          protocolVersion:
            typeof requested === 'string' &&
            MCP_PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : MCP_PROTOCOL_VERSIONS[0],
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
          },
          serverInfo: { name: 'actual-cli', version: options.version },
          instructions:
            'Tools mirror actual CLI operations. Read actual://domains first. Mutating tools are guarded changes: preview with changes_preview, then apply with changes_apply and an operation ID.',
        });
        return;
      }
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list': {
        const tools = [...bindings.values()].map(({ tool }) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        }));
        const pageSize = 100;
        const start =
          typeof params.cursor === 'string' ? Number(params.cursor) || 0 : 0;
        const page = tools.slice(start, start + pageSize);
        reply(id, {
          tools: page,
          ...(start + pageSize < tools.length
            ? { nextCursor: String(start + pageSize) }
            : {}),
        });
        return;
      }
      case 'tools/call':
        callTool(id, params);
        return;
      case 'resources/list':
        reply(id, { resources: RESOURCES });
        return;
      case 'resources/templates/list':
        reply(id, {
          resourceTemplates: [
            {
              uriTemplate: 'actual://schema/{tool}',
              name: 'tool-schema',
              description: 'Registry entry and input schema for one tool',
              mimeType: 'application/json',
            },
          ],
        });
        return;
      case 'resources/read': {
        const uri = String(params.uri);
        let value: unknown;
        if (uri === 'actual://domains') {
          value = domains();
        } else if (uri === 'actual://operations') {
          value = discoverOperations(options.root).filter(o =>
            bindings.has(toolName(o.name)),
          );
        } else if (uri.startsWith('actual://schema/')) {
          const binding = bindings.get(uri.slice('actual://schema/'.length));
          if (binding) value = binding.tool;
        }
        if (value === undefined) {
          fail(id, -32002, `Resource not found: ${uri}`);
          return;
        }
        reply(id, {
          contents: [
            { uri, mimeType: 'application/json', text: JSON.stringify(value) },
          ],
        });
        return;
      }
      default:
        fail(id, -32601, `Method not found: ${method}`);
    }
  }

  return new Promise(resolve => {
    const lines = createInterface({ input: options.input ?? process.stdin });
    lines.on('line', line => {
      if (!line.trim()) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        fail(null, -32700, 'Parse error');
        return;
      }
      if (
        typeof message !== 'object' ||
        message === null ||
        (message as Request).jsonrpc !== '2.0' ||
        typeof (message as Request).method !== 'string'
      ) {
        if (
          typeof message === 'object' &&
          message !== null &&
          'id' in message &&
          !('method' in message)
        ) {
          return; // A response to a server request; none are sent.
        }
        fail(null, -32600, 'Invalid request');
        return;
      }
      handle(message as Request);
    });
    lines.on('close', () => {
      // Stdin closed: stop in-flight children so no orphan keeps running.
      for (const child of running.values()) child.kill('SIGTERM');
      running.clear();
      resolve();
    });
  });
}
