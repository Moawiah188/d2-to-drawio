#!/usr/bin/env node
// CLI for d2-to-drawio: convert D2 diagram source to draw.io XML.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';
import {
  convert,
  convertFile,
  buildImportFs,
  dispose,
  D2SyntaxError,
  UnsupportedFeatureError,
} from '../src/index.js';

const HELP = `Usage: d2-to-drawio [options] [input.d2]

Convert a D2 diagram (d2lang.com) to an editable draw.io / diagrams.net file.

Reads from the input file, or from stdin when no file is given (or "-").
Writes to --output, or to stdout.

Options:
  -o, --output <file>   write the .drawio XML to a file instead of stdout
      --layout <name>   layout engine: dagre (default) or elk
      --theme <id>      D2 theme id (default 0)
      --waypoints       preserve D2 edge routes as fixed waypoints
      --strict          fail when input uses features that would degrade
  -q, --quiet           suppress warnings on stderr
  -h, --help            show this help
  -v, --version         print the version

Examples:
  d2-to-drawio diagram.d2 -o diagram.drawio
  cat diagram.d2 | d2-to-drawio > diagram.drawio
`;

function version() {
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
  );
  return pkg.version;
}

function usageError(msg) {
  process.stderr.write(`error: ${msg}\n\n${HELP}`);
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        layout: { type: 'string' },
        theme: { type: 'string' },
        waypoints: { type: 'boolean' },
        strict: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    usageError(err.message);
  }
  const { values, positionals } = args;

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (positionals.length > 1) usageError('expected at most one input file');
  if (values.layout && values.layout !== 'dagre' && values.layout !== 'elk') {
    usageError(`unknown layout "${values.layout}" (expected dagre or elk)`);
  }
  let themeID;
  if (values.theme !== undefined) {
    themeID = Number(values.theme);
    if (!Number.isInteger(themeID) || themeID < 0) usageError(`invalid theme id "${values.theme}"`);
  }

  // layout and themeID stay undefined unless given, so an in-file
  // vars.d2-config block keeps control of them.
  const convertOptions = {
    layout: values.layout,
    themeID,
    strict: Boolean(values.strict),
    waypoints: Boolean(values.waypoints),
    onWarning: values.quiet ? undefined : (w) => process.stderr.write(`warning: ${w.message}\n`),
  };

  const inputPath = positionals[0];
  let xml;
  try {
    if (!inputPath || inputPath === '-') {
      if (process.stdin.isTTY) usageError('no input file given and stdin is a terminal');
      const source = await readStdin();
      // Imports in piped input resolve against the current directory.
      xml = await convert(source, { ...convertOptions, fsMap: buildImportFs(process.cwd()) });
    } else {
      xml = await convertFile(inputPath, convertOptions);
    }
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EISDIR')) {
      process.stderr.write(`error: cannot read "${inputPath}": ${err.message}\n`);
      return 1;
    }
    if (err instanceof D2SyntaxError || err instanceof UnsupportedFeatureError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (values.output) {
    try {
      writeFileSync(values.output, xml, 'utf8');
    } catch (err) {
      process.stderr.write(`error: cannot write "${values.output}": ${err.message}\n`);
      return 1;
    }
  } else {
    process.stdout.write(xml);
  }
  return 0;
}

main()
  .then(async (code) => {
    await dispose();
    // The engine's worker thread would otherwise keep the process alive.
    process.exit(code);
  })
  .catch(async (err) => {
    process.stderr.write(`error: ${err && err.message ? err.message : err}\n`);
    await dispose();
    process.exit(1);
  });
