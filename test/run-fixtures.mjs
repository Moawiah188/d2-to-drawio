#!/usr/bin/env node
// Convert every test/fixtures/*.d2 in one process (the engine worker is
// reused, so this is far faster than one CLI run per file) and write the
// outputs plus captured warnings to the directory given as argv[2]
// (default: test/snapshots). template.d2 is import-only and is skipped.

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFile, dispose, D2SyntaxError } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const outDir = process.argv[2] ?? join(here, 'snapshots');
mkdirSync(outDir, { recursive: true });

const skip = new Set(['template.d2']);
const files = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.d2') && !skip.has(f))
  .sort();

let failed = 0;
for (const f of files) {
  const name = f.replace(/\.d2$/, '');
  const warnings = [];
  const started = performance.now();
  try {
    const xml = await convertFile(join(fixtureDir, f), {
      onWarning: (w) => warnings.push(w.message),
    });
    const ms = Math.round(performance.now() - started);
    writeFileSync(join(outDir, `${name}.drawio`), xml, 'utf8');
    writeFileSync(
      join(outDir, `${name}.warnings.txt`),
      warnings.length > 0 ? warnings.join('\n') + '\n' : '',
      'utf8'
    );
    const v = (xml.match(/vertex="1"/g) || []).length;
    const e = (xml.match(/edge="1"/g) || []).length;
    const pages = (xml.match(/<diagram /g) || []).length;
    console.log(
      `OK   ${name} (${v}v/${e}e/${pages}p, ${ms}ms${warnings.length ? `, ${warnings.length} warnings` : ''})`
    );
  } catch (err) {
    failed++;
    const kind = err instanceof D2SyntaxError ? 'compile error' : 'CRASH';
    console.log(`FAIL ${name}: ${kind}: ${err.message.split('\n')[0]}`);
  }
}

await dispose();
console.log(`\n${files.length - failed}/${files.length} fixtures converted`);
process.exitCode = failed === 0 ? 0 : 1;
