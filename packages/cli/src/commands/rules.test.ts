import * as api from '@actual-app/api';
import { Command } from 'commander';

import { printOutput } from '#output';

import { registerRulesCommand } from './rules';

vi.mock('@actual-app/api', () => ({
  testRules: vi.fn(),
}));

vi.mock('#connection', () => ({
  withConnection: vi.fn((_opts, fn) => fn()),
}));

vi.mock('#output', () => ({
  printOutput: vi.fn(),
}));

function createProgram(): Command {
  const program = new Command();
  program.option('--format <format>');
  program.option('--output-version <version>');
  program.exitOverride();
  registerRulesCommand(program);
  return program;
}

async function run(args: string[]) {
  await createProgram().parseAsync(['node', 'test', ...args]);
}

const sample = {
  account: 'acct',
  date: '2026-10-20',
  amount: -1250,
  imported_payee: 'COFFEE BAR',
};

describe('rules test', () => {
  beforeEach(() => {
    vi.mocked(api.testRules).mockReset();
    vi.mocked(printOutput).mockReset();
  });

  it('tests one sample and prints its result', async () => {
    vi.mocked(api.testRules).mockResolvedValue({ result: { id: 1 } } as never);

    await run(['rules', 'test', '--data', JSON.stringify(sample)]);

    expect(api.testRules).toHaveBeenCalledWith({ transaction: sample });
    expect(printOutput).toHaveBeenCalledWith({ result: { id: 1 } }, undefined);
  });

  it('tests an array of samples and reports per-sample errors in place', async () => {
    vi.mocked(api.testRules)
      .mockResolvedValueOnce({ result: 'first' } as never)
      .mockRejectedValueOnce(new Error('bad account'))
      .mockResolvedValueOnce({ result: 'third' } as never);

    await run([
      'rules',
      'test',
      '--payee-names',
      'original',
      '--data',
      JSON.stringify([sample, sample, sample]),
    ]);

    expect(api.testRules).toHaveBeenCalledTimes(3);
    expect(api.testRules).toHaveBeenCalledWith({
      transaction: sample,
      payeeNameNormalization: 'original',
    });
    expect(printOutput).toHaveBeenCalledWith(
      [{ result: 'first' }, { error: 'bad account' }, { result: 'third' }],
      undefined,
    );
  });

  it('refuses a batch over the limit before connecting', async () => {
    await expect(
      run([
        'rules',
        'test',
        '--data',
        JSON.stringify(Array.from({ length: 5001 }, () => sample)),
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(api.testRules).not.toHaveBeenCalled();
  });
});
