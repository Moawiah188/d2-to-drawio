# d2-to-drawio

[![npm version](https://img.shields.io/npm/v/d2-to-drawio)](https://www.npmjs.com/package/d2-to-drawio)
[![CI](https://github.com/Moawiah188/d2-to-drawio/actions/workflows/ci.yml/badge.svg)](https://github.com/Moawiah188/d2-to-drawio/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/d2-to-drawio)](https://github.com/Moawiah188/d2-to-drawio/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/d2-to-drawio)](https://nodejs.org)

Convert D2 diagrams to draw.io files: keep authoring diagrams as code in [D2](https://d2lang.com), and hand fully editable drawio / [diagrams.net](https://www.diagrams.net) files to everyone else. Shapes, containers, edges, styles, and positions all come across as native draw.io elements, not as a pasted image.

```
npx d2-to-drawio examples/basic.d2 -o basic.drawio
```

## What you get

```d2
direction: right

user: Visitor { shape: person }
app: "Web App"
db: "Postgres" { shape: cylinder }

user -> app: "browses"
app -> db: "reads / writes"
```

```
npx d2-to-drawio examples/basic.d2 -o basic.drawio
```

The result, opened in draw.io, every element selectable and editable:

![basic example rendered in draw.io](https://raw.githubusercontent.com/Moawiah188/d2-to-drawio/main/docs/assets/basic.png)

A richer example with containers, a queue, crow's foot cardinality, and tooltips ([source](https://github.com/Moawiah188/d2-to-drawio/blob/main/examples/microservices.d2)):

![microservices example rendered in draw.io](https://raw.githubusercontent.com/Moawiah188/d2-to-drawio/main/docs/assets/microservices.png)

Open the committed outputs directly in your browser:

- [Open basic.drawio in app.diagrams.net](https://app.diagrams.net/#Uhttps%3A%2F%2Fraw.githubusercontent.com%2FMoawiah188%2Fd2-to-drawio%2Fmain%2Fexamples%2Fbasic.drawio)
- [Open microservices.drawio in app.diagrams.net](https://app.diagrams.net/#Uhttps%3A%2F%2Fraw.githubusercontent.com%2FMoawiah188%2Fd2-to-drawio%2Fmain%2Fexamples%2Fmicroservices.drawio)

<!-- PLACEHOLDER: drop a real screenshot of one of these files open in the app.diagrams.net editor (with the draw.io UI visible) here, e.g. docs/assets/editor-screenshot.png, and reference it with an absolute raw.githubusercontent.com URL. -->

## Why this exists

Plenty of teams standardize on draw.io and Confluence for documentation, while the engineers drawing the systems would rather write diagrams as code, version them, and review them in pull requests. Exporting D2 to SVG or PNG hands the team a static picture nobody can edit; switching the whole team to D2 rarely happens. This tool removes that one-way door: engineers keep the `.d2` source of truth, everyone else gets a native `.drawio` file they can open, edit, and paste into Confluence.

## Quick start

```
npm install -g d2-to-drawio
d2-to-drawio diagram.d2 -o diagram.drawio
```

Or without installing:

```
npx d2-to-drawio diagram.d2 -o diagram.drawio
```

Or from stdin to stdout:

```
cat diagram.d2 | d2-to-drawio > diagram.drawio
```

## CLI reference

```
Usage: d2-to-drawio [options] [input.d2]

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
```

Behavior notes:

- `@imports` resolve automatically: for file input, every `.d2` under the input file's directory is available to the compiler; for stdin, imports resolve against the current directory.
- Unsupported D2 features never crash a conversion. Each degrades to the closest visual and prints one warning line to stderr. `--strict` turns those warnings into a failing exit instead.
- By default draw.io re-routes edges orthogonally, which keeps them fully editable. `--waypoints` pins d2's exact computed routes instead.
- Exit codes: 0 success, 1 conversion or input error, 2 usage error.

## Library API

```js
import { convert, convertFile, dispose } from 'd2-to-drawio';

const xml = await convert('a -> b: hello');
// or, resolving imports relative to the file:
const xml2 = await convertFile('diagram.d2', { layout: 'elk' });

await dispose();
```

- `convert(d2Source, options)` returns a Promise of the `.drawio` XML string.
- `convertFile(inputPath, options)` reads the file and feeds sibling `.d2` files to the compiler so relative imports work.
- `options`: `layout` ('dagre' | 'elk'), `themeID` (number), `strict` (boolean), `waypoints` (boolean), `onWarning` (callback receiving `{code, message}`), `fsMap`/`inputPath` (virtual filesystem for imports when using `convert`).
- `dispose()` releases the compiler's worker thread. Call it when done, or your process will stay alive. The next `convert` after a `dispose` transparently starts a fresh engine.
- Errors: malformed D2 rejects with `D2SyntaxError` (message carries `file:line:column`); strict-mode degradations reject with `UnsupportedFeatureError` (carrying the warning list).

Output is deterministic: identical input produces byte-identical output, so generated files diff cleanly in version control.

## Feature support

The full, fixture-backed matrix lives in [docs/FEATURE-MATRIX.md](https://github.com/Moawiah188/d2-to-drawio/blob/main/docs/FEATURE-MATRIX.md). Summary:

| Area | Support |
|---|---|
| Shape catalog (rectangle, square, page, parallelogram, document, cylinder, queue, package, step, callout, stored_data, person, diamond, oval, circle, hexagon, cloud, image, text) | Full |
| Containers, any nesting depth, grid diagrams | Full |
| Connections: `->` `<-` `<->` `--`, chains, parallel edges, self-loops | Full |
| Arrowheads incl. crow's foot ER markers, arrowhead labels | Full |
| Styles: fill, stroke, stroke-width, stroke-dash, opacity, shadow, fonts, bold/italic/underline | Full |
| Themes: all 20 official palettes | Full |
| Compiler-level features: vars, globs, classes, imports, overrides, null | Full |
| Boards (layers, scenarios, steps) | Full, one draw.io page per board |
| Tooltips and links | Full |
| sql_table, class (UML) | Partial: formatted single shapes, not row-by-row cells |
| Sequence diagrams | Partial: exact d2 geometry, but fixed (does not re-route) |
| Markdown / LaTeX / code labels | Partial: plain text / MathJax / monospace box |
| multiple, 3d, double-border, fill-pattern, animated, sketch | Unsupported, warned |

## Limitations

- The compiler dependency (`@terrastruct/d2`, the official WASM build of D2) is around 60 MB installed and takes a couple of seconds to start. One-shot CLI runs pay that startup; batch conversions should use the library API, which reuses the engine across calls.
- sql_table and class shapes are single shapes with formatted labels. Editing individual rows as draw.io table cells is on the roadmap.
- Sequence diagram messages and lifelines keep d2's exact geometry and will not re-route if you move the actors.
- Links between D2 boards (`link: layers.x`) do not become page links in draw.io yet.
- The TALA layout engine is not part of the embedded compiler; `dagre` and `elk` are available.

## How it works

The official D2 compiler (as a WASM build) parses the source and runs the real layout engine, producing fully positioned shapes and routed connections. This tool walks that output, rebuilds the container tree, and translates shapes, styles, and theme colors into draw.io's mxGraph cell model. It then emits deterministic, uncompressed `.drawio` XML that draw.io opens like any hand-drawn file.

## Roadmap

Only things actually planned:

- Native draw.io table cells for sql_table and class shapes.
- draw.io sketch style for D2 sketch mode.
- Page links for D2 board links.
- Icons on regular shapes (currently only `shape: image` carries an image).

## Related projects

As of July 2026 this is the only dedicated D2 to draw.io converter I am aware of. Related tools:

- [D2](https://github.com/terrastruct/d2): the diagram language itself.
- [draw.io / diagrams.net](https://github.com/jgraph/drawio): the editor this tool targets.
- [@whitebite/diagram-converter](https://www.npmjs.com/package/@whitebite/diagram-converter): a universal multi-format diagram converter whose published build includes a D2 parser and drawio generator via a shared intermediate representation. A generalist; this tool goes deeper on D2 fidelity (layout preservation, themes, special shapes, degradation warnings).
- [mmd2drawio](https://github.com/youyoubilly/mmd2drawio): the same idea for Mermaid.
- The SVG detour: D2 can export SVG that draw.io imports as a static image. Works, but nothing is editable; that gap is the point of this project (see also [jgraph/drawio#3764](https://github.com/jgraph/drawio/issues/3764), an open request for D2 input in draw.io itself).

## Contributing

See [CONTRIBUTING.md](https://github.com/Moawiah188/d2-to-drawio/blob/main/CONTRIBUTING.md). The short version: fixture first, then the mapping code, then a row in the feature matrix. Bug reports with a minimal `.d2` snippet are gold.

## License

[MIT](https://github.com/Moawiah188/d2-to-drawio/blob/main/LICENSE). The `@terrastruct/d2` dependency is MPL-2.0, used unmodified.
