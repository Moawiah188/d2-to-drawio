#!/usr/bin/env node
// Structural validator for draw.io output files.
// Checks every .drawio file in test/golden against the invariants the
// draw.io format requires:
//   1. Well-formed XML (real parser, not regex).
//   2. Element chain mxfile > diagram > mxGraphModel > root.
//   3. Root cells id="0" and id="1" (with parent="0") exist.
//   4. Every vertex cell has an mxGeometry with numeric x/y/width/height.
//   5. Every edge cell's source and target reference existing cell ids.
//   6. Every cell's parent references an existing cell id.
//   7. Content is uncompressed XML (diagram has element children, not text).

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'golden');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  isArray: (name) => name === 'mxCell' || name === 'diagram',
});

function validateFile(path) {
  const errors = [];
  const xml = readFileSync(path, 'utf8');

  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) {
    return [`not well-formed XML: ${JSON.stringify(wellFormed.err)}`];
  }

  const doc = parser.parse(xml);
  const mxfile = doc.mxfile;
  if (!mxfile) return ['missing <mxfile> root element'];
  const diagrams = mxfile.diagram;
  if (!diagrams || diagrams.length === 0) return ['missing <diagram> element'];

  for (const diagram of diagrams) {
    if (typeof diagram === 'string' || diagram['#text']) {
      errors.push('diagram content is text (compressed?), expected uncompressed XML children');
      continue;
    }
    const model = diagram.mxGraphModel;
    if (!model) {
      errors.push('missing <mxGraphModel> under <diagram>');
      continue;
    }
    const root = model.root;
    if (!root) {
      errors.push('missing <root> under <mxGraphModel>');
      continue;
    }
    const cells = root.mxCell ?? [];
    const ids = new Set(cells.map((c) => c['@_id']));

    if (!ids.has('0')) errors.push('missing root cell id="0"');
    const cell1 = cells.find((c) => c['@_id'] === '1');
    if (!cell1) errors.push('missing root cell id="1"');
    else if (cell1['@_parent'] !== '0') errors.push('cell id="1" parent is not "0"');

    if (ids.size !== cells.length) errors.push('duplicate cell ids');

    for (const c of cells) {
      const id = c['@_id'];
      if (id === '0') continue;
      const parent = c['@_parent'];
      if (!ids.has(parent)) errors.push(`cell "${id}": parent "${parent}" does not exist`);

      if (c['@_vertex'] === '1') {
        const g = c.mxGeometry;
        if (!g) {
          errors.push(`vertex "${id}": missing mxGeometry`);
          continue;
        }
        for (const attr of ['x', 'y', 'width', 'height']) {
          const v = g[`@_${attr}`];
          if (v === undefined || Number.isNaN(parseFloat(v))) {
            errors.push(`vertex "${id}": mxGeometry ${attr} is not numeric (${v})`);
          }
        }
      }

      if (c['@_edge'] === '1') {
        for (const end of ['source', 'target']) {
          const ref = c[`@_${end}`];
          if (ref === undefined) errors.push(`edge "${id}": missing ${end}`);
          else if (!ids.has(ref)) errors.push(`edge "${id}": ${end} "${ref}" does not exist`);
        }
        const g = c.mxGeometry;
        if (!g || g['@_relative'] !== '1') errors.push(`edge "${id}": mxGeometry relative="1" missing`);
      }
    }
  }
  return errors;
}

let failed = 0;
const files = readdirSync(goldenDir).filter((f) => f.endsWith('.drawio')).sort();
if (files.length === 0) {
  console.error('no .drawio files found in test/golden');
  process.exit(1);
}
for (const f of files) {
  const errors = validateFile(join(goldenDir, f));
  if (errors.length === 0) {
    console.log(`PASS ${f}`);
  } else {
    failed++;
    console.log(`FAIL ${f}`);
    for (const e of errors) console.log(`     - ${e}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} golden files pass structural validation`);
process.exit(failed === 0 ? 0 : 1);
