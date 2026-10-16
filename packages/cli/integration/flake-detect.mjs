#!/usr/bin/env node
// Repeat-runs a test file several times and reports tests whose result is not
// the same on every run (a flake), plus tests that failed every time.
//
//   node integration/flake-detect.mjs --runs 10 integration/lifecycle.test.mjs
//   node integration/flake-detect.mjs --runs 20 --jobs 4 --timeout 600 a.test.mjs b.test.mjs
//   node integration/flake-detect.mjs --runs 20 --vitest src/lock.test.ts
//
// Options: --cwd DIR (run from another package, for example packages/desktop-client), --runs N (default 5), --jobs J parallel runs (default 1), --timeout S
// per run in seconds (default 900), --vitest for vitest files, --keep-logs DIR to
// save the raw output of every run that had a failure. Exit code: 0 stable and
// green, 1 flaky or failing, 2 usage error. Build first (`yarn build:cli`).
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function parseTap(output) {
  const results = new Map();
  for (const line of output.split('\n')) {
    const match = /^(\s*)(ok|not ok) \d+ - (.*?)(?:\s+# (SKIP|TODO).*)?$/.exec(
      line,
    );
    if (!match) continue;
    const [, indent, status, name, directive] = match;
    if (directive) continue;
    // Suites and their subtests share names across files only by accident; key
    // by indentation depth and name.
    results.set(`${indent.length / 4}:${name.trim()}`, status === 'ok');
  }
  return results;
}

export function parseVitestJson(output, outputFile) {
  if (outputFile && existsSync(outputFile)) {
    output = readFileSync(outputFile, 'utf8');
    rmSync(outputFile, { force: true });
  }
  const start = output.indexOf('{');
  const results = new Map();
  // Keep the raw report so a kept log shows each failure message.
  results.raw = output;
  if (start < 0) return results;
  let json;
  try {
    json = JSON.parse(output.slice(start, output.lastIndexOf('}') + 1));
  } catch {
    return results;
  }
  for (const file of json.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      if (test.status === 'skipped' || test.status === 'pending') continue;
      results.set(`${file.name}::${test.fullName}`, test.status === 'passed');
    }
  }
  return results;
}

export function summarize(allRuns) {
  const crashed = allRuns.filter(run => run.results.size === 0 || run.timedOut);
  // A crashed run says nothing about individual tests; compare the others.
  const runs = allRuns.filter(run => !crashed.includes(run));
  const names = new Set(runs.flatMap(run => [...run.results.keys()]));
  const flaky = [];
  const alwaysFailing = [];
  for (const name of names) {
    const outcomes = runs.map(run => run.results.get(name));
    const passed = outcomes.filter(o => o === true).length;
    const failed = outcomes.filter(o => o === false).length;
    const missing = outcomes.length - passed - failed;
    if (passed > 0 && (failed > 0 || missing > 0)) {
      flaky.push({ name, passed, failed, missing });
    } else if (failed > 0 && passed === 0) {
      alwaysFailing.push({ name, failed });
    }
  }
  return { flaky, alwaysFailing, crashed: crashed.map(run => run.index) };
}

function runOnce(index, command, baseArgs, timeoutMs, parse, cwd, vitest) {
  return new Promise(resolve => {
    // vitest projects may write their JSON report to a file of their own, so ask
    // for a file we know.
    const outputFile = join(tmpdir(), `flake-${process.pid}-${index}.json`);
    const args = vitest
      ? [...baseArgs, `--outputFile=${outputFile}`]
      : baseArgs;
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PWD: cwd },
    });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    child.on('close', code => {
      clearTimeout(timer);
      const results = parse(output, outputFile);
      resolve({
        index,
        code,
        timedOut,
        output: results.raw ?? output,
        results,
      });
    });
  });
}

async function main(argv) {
  const options = { runs: 5, jobs: 1, timeout: 900, vitest: false };
  let cwd = root;
  let logDir;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') options.runs = Number(argv[++i]);
    else if (arg === '--jobs') options.jobs = Number(argv[++i]);
    else if (arg === '--timeout') options.timeout = Number(argv[++i]);
    else if (arg === '--keep-logs') logDir = argv[++i];
    else if (arg === '--vitest') options.vitest = true;
    else if (arg === '--cwd') cwd = resolve(argv[++i]);
    else if (arg.startsWith('--')) {
      console.error(`Unknown option ${arg}`);
      return 2;
    } else files.push(arg);
  }
  if (
    !files.length ||
    ![options.runs, options.jobs, options.timeout].every(
      n => Number.isInteger(n) && n > 0,
    )
  ) {
    console.error(
      'Usage: flake-detect.mjs [--runs N] [--jobs J] [--timeout S] [--vitest] [--cwd DIR] [--keep-logs DIR] <test files>',
    );
    return 2;
  }
  const [command, args, parse] = options.vitest
    ? ['npx', ['vitest', '--run', '--reporter=json', ...files], parseVitestJson]
    : ['node', ['--test', '--test-reporter=tap', ...files], parseTap];

  const runs = [];
  let next = 0;
  async function worker() {
    while (next < options.runs) {
      const index = ++next;
      const run = await runOnce(
        index,
        command,
        args,
        options.timeout * 1000,
        parse,
        cwd,
        options.vitest,
      );
      runs.push(run);
      const failed = [...run.results.values()].filter(ok => !ok).length;
      console.log(
        `run ${index}/${options.runs}: ${run.results.size} tests, ${failed} failed${run.timedOut ? ', TIMED OUT' : ''}`,
      );
      if (logDir && (failed > 0 || run.timedOut || run.code !== 0)) {
        mkdirSync(logDir, { recursive: true });
        writeFileSync(join(logDir, `run-${index}.log`), run.output);
      }
    }
  }
  await Promise.all(Array.from({ length: options.jobs }, worker));
  runs.sort((a, b) => a.index - b.index);

  const { flaky, alwaysFailing, crashed } = summarize(runs);
  console.log(`\n${runs.length} runs of ${files.join(' ')}`);
  for (const f of flaky) {
    console.log(
      `FLAKY  ${f.name}: passed ${f.passed}, failed ${f.failed}, missing ${f.missing}`,
    );
  }
  for (const f of alwaysFailing)
    console.log(`FAILS  ${f.name}: failed all ${f.failed} runs`);
  if (crashed.length)
    console.log(`CRASHED/TIMED OUT runs: ${crashed.join(', ')}`);
  if (!flaky.length && !alwaysFailing.length && !crashed.length) {
    console.log('stable: every test had the same passing result on every run');
    return 0;
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
