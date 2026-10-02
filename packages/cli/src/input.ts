import { readFileSync } from 'fs';

const inputs = new WeakMap<object, unknown>();

export function readJsonInput(cmdOpts: {
  data?: string;
  file?: string;
}): unknown {
  if (inputs.has(cmdOpts)) return inputs.get(cmdOpts);
  if (cmdOpts.data && cmdOpts.file) {
    throw new Error('Cannot use both --data and --file');
  }
  if (cmdOpts.data) {
    const value: unknown = JSON.parse(cmdOpts.data);
    inputs.set(cmdOpts, value);
    return value;
  }
  if (cmdOpts.file) {
    const content =
      cmdOpts.file === '-'
        ? readFileSync(0, 'utf-8')
        : readFileSync(cmdOpts.file, 'utf-8');
    const value: unknown = JSON.parse(content);
    inputs.set(cmdOpts, value);
    return value;
  }
  throw new Error('Either --data or --file is required');
}
