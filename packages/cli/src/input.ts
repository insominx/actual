import { readFileSync } from 'fs';

import { AgentError } from '#agent-output';

const inputs = new WeakMap<object, unknown>();

// Strict UTF-8 (a leading byte order mark, as Windows PowerShell writes, is
// dropped). Lossy decoding would store U+FFFD in place of the caller's text.
const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeInput(bytes: Buffer) {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      'The JSON input is not valid UTF-8; re-save it as UTF-8.',
    );
  }
}

// A lone surrogate (for example "\ud800" in JSON) cannot be stored as text;
// the engine fails after the operation ID is spent, leaving it uncertain.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertWellFormed(value: unknown) {
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) {
      throw new AgentError(
        'INVALID_INPUT',
        'The JSON input contains text that is not valid Unicode (a lone surrogate).',
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach(assertWellFormed);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      assertWellFormed(key);
      assertWellFormed(item);
    }
  }
}

function parseInput(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // A SyntaxError would otherwise surface as a generic engine failure
    throw new AgentError('INVALID_INPUT', 'The JSON input is not valid JSON.');
  }
  assertWellFormed(value);
  return value;
}

export function readJsonInput(cmdOpts: {
  data?: string;
  file?: string;
}): unknown {
  if (inputs.has(cmdOpts)) return inputs.get(cmdOpts);
  if (cmdOpts.data && cmdOpts.file) {
    throw new AgentError('INVALID_INPUT', 'Cannot use both --data and --file');
  }
  if (cmdOpts.data) {
    const value = parseInput(cmdOpts.data);
    inputs.set(cmdOpts, value);
    return value;
  }
  if (cmdOpts.file) {
    let bytes: Buffer;
    try {
      bytes =
        cmdOpts.file === '-' ? readFileSync(0) : readFileSync(cmdOpts.file);
    } catch {
      throw new AgentError(
        'INVALID_INPUT',
        `Could not read the JSON input file "${cmdOpts.file}".`,
      );
    }
    const value = parseInput(decodeInput(bytes));
    inputs.set(cmdOpts, value);
    return value;
  }
  throw new AgentError('INVALID_INPUT', 'Either --data or --file is required');
}
