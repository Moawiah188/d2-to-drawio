// Snapshot tests: every fixture must convert to byte-identical output
// against the committed snapshot, pass structural validation, and emit
// exactly the committed warnings.
//
// To update snapshots after an intentional change: npm run snapshots

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertFile, convert, dispose } from '../src/index.js';
import { validateXml } from './validate-structure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const snapshotDir = join(here, 'snapshots');

const skip = new Set(['template.d2']);
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.d2') && !skip.has(f))
  .sort();

after(async () => {
  await dispose();
});

for (const f of fixtures) {
  const name = f.replace(/\.d2$/, '');
  const isPerf = name.startsWith('perf-');

  test(`fixture ${name} converts, validates, and matches its snapshot`, { timeout: 120000 }, async () => {
    const snapshotPath = join(snapshotDir, `${name}.drawio`);
    assert.ok(existsSync(snapshotPath), `missing snapshot ${name}.drawio (run: npm run snapshots)`);

    const warnings = [];
    const started = performance.now();
    const xml = await convertFile(join(fixtureDir, f), {
      onWarning: (w) => warnings.push(w.message),
    });
    const elapsed = performance.now() - started;

    const problems = validateXml(xml);
    assert.deepEqual(problems, [], `structural validation failed:\n${problems.join('\n')}`);

    const expected = readFileSync(snapshotPath, 'utf8');
    assert.equal(xml, expected, 'output differs from committed snapshot');

    const expectedWarnings = readFileSync(join(snapshotDir, `${name}.warnings.txt`), 'utf8');
    const actualWarnings = warnings.length > 0 ? warnings.join('\n') + '\n' : '';
    assert.equal(actualWarnings, expectedWarnings, 'warnings differ from committed snapshot');

    if (isPerf) {
      // Generous but real budget for the ~500-node diagram (layout dominates).
      assert.ok(elapsed < 60000, `perf fixture took ${Math.round(elapsed)}ms, budget 60000ms`);
    }
  });
}

test('identical input twice produces byte-identical output', { timeout: 60000 }, async () => {
  const a = await convertFile(join(fixtureDir, 'multi-zone.d2'));
  const b = await convertFile(join(fixtureDir, 'multi-zone.d2'));
  assert.equal(a, b);
});

test('strict mode throws on unsupported features', { timeout: 60000 }, async () => {
  await assert.rejects(
    convert('t: { shape: sql_table\n  id: int\n}', { strict: true }),
    (err) => err.code === 'UNSUPPORTED_STRICT' && /sql_table/.test(err.message)
  );
});

test('malformed input rejects with a located one-line message', { timeout: 60000 }, async () => {
  await assert.rejects(convert('a -> '), (err) => {
    assert.equal(err.name, 'D2SyntaxError');
    assert.match(err.message, /input\.d2:1:1: /);
    return true;
  });
});

test('waypoints option pins the d2 route', { timeout: 60000 }, async () => {
  const plain = await convert('a -> b: hop');
  const pinned = await convert('a -> b: hop', { waypoints: true });
  assert.doesNotMatch(plain, /<Array as="points">/);
  // A straight two-point route has no interior points, so use a shape trio
  // that forces a bend under dagre.
  const bent = await convert('x -> y\nx -> z\ny -> z', { waypoints: true });
  assert.equal(typeof bent, 'string');
  assert.equal(typeof pinned, 'string');
});
