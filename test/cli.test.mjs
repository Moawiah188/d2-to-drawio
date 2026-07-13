// End-to-end CLI tests through child_process: real argv, stdin/stdout,
// exit codes, and stderr behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'bin', 'd2-to-drawio.js');
const fixtureDir = join(here, 'fixtures');
const outDir = mkdtempSync(join(tmpdir(), 'd2-to-drawio-cli-'));

function run(args, { input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [bin, ...args],
      { timeout: 90000 },
      (error, stdout, stderr) => {
        resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr });
      }
    );
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

test('--help prints usage and exits 0', { timeout: 60000 }, async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: d2-to-drawio/);
});

test('--version prints the package version', { timeout: 60000 }, async () => {
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const r = await run(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('file input with -o writes the file', { timeout: 90000 }, async () => {
  const out = join(outDir, 'basic.drawio');
  const r = await run([join(fixtureDir, 'basic.d2'), '-o', out]);
  assert.equal(r.code, 0);
  assert.ok(existsSync(out));
  assert.match(readFileSync(out, 'utf8'), /^<mxfile /);
});

test('stdin to stdout', { timeout: 90000 }, async () => {
  const r = await run([], { input: 'x -> y: hello' });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^<mxfile /);
  assert.match(r.stdout, /hello/);
});

test('warnings go to stderr, --quiet silences them', { timeout: 90000 }, async () => {
  const src = 't: { shape: sql_table\n  id: int\n}';
  const noisy = await run([], { input: src });
  assert.equal(noisy.code, 0);
  assert.match(noisy.stderr, /warning: sql_table/);
  const quiet = await run(['--quiet'], { input: src });
  assert.equal(quiet.code, 0);
  assert.equal(quiet.stderr, '');
});

test('--strict fails on degraded features with exit 1', { timeout: 90000 }, async () => {
  const r = await run(['--strict'], { input: 't: { shape: sql_table\n  id: int\n}' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: strict mode/);
});

test('malformed d2 exits 1 with a one-line located error, no stack trace', { timeout: 90000 }, async () => {
  const r = await run([], { input: 'a -> ' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: input\.d2:1:1: /);
  assert.doesNotMatch(r.stderr, /at .*:\d+:\d+/);
});

test('missing input file exits 1', { timeout: 60000 }, async () => {
  const r = await run(['no-such-file.d2']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /cannot read/);
});

test('unknown flag exits 2 with usage', { timeout: 60000 }, async () => {
  const r = await run(['--bogus']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage: d2-to-drawio/);
});

test('invalid layout exits 2', { timeout: 60000 }, async () => {
  const r = await run(['--layout', 'tala', join(fixtureDir, 'basic.d2')]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown layout/);
});
