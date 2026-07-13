# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-07-14

### Changed

- README now documents the AI-drafted diagram workflow: models write D2 (no coordinates to invent), the layout engine places it, the converted file stays editable in draw.io. Documentation-only release to refresh the npm package page.

## [1.0.0] - 2026-07-13

### Added

- `convert(d2Source, options)` and `convertFile(path, options)` library API returning uncompressed draw.io XML.
- `d2-to-drawio` CLI: file or stdin input, `-o` or stdout output, `--layout dagre|elk`, `--theme <id>`, `--waypoints`, `--strict`, `--quiet`, `--help`, `--version`.
- Conversion built on the official D2 compiler (`@terrastruct/d2`), so vars, globs, classes, imports, overrides, and layout all behave exactly as `d2` does.
- Shape catalog mapping (rectangle, square, page, parallelogram, document, cylinder, queue, package, step, callout, stored_data, person, diamond, oval, circle, hexagon, cloud, image, text).
- Containers at any depth with parent-relative coordinates; grid diagrams via computed positions.
- All four connection operators, chains, parallel edges, self-loops, arrowheads including crow's foot ER markers, and arrowhead labels.
- Styles: fill, stroke, stroke-width, stroke-dash, border-radius, opacity, shadow, fonts, bold/italic/underline, mono, with all 20 official D2 theme palettes resolved to hex.
- sql_table and class shapes rendered as formatted single shapes; sequence diagrams with exact d2 geometry; LaTeX labels through draw.io math mode.
- D2 boards (layers, scenarios, steps) as multiple draw.io pages.
- Tooltips and links on shapes and edges.
- Degradation contract: unsupported features warn on stderr and degrade; `--strict` fails instead. Deterministic, byte-identical output for identical input.

[1.0.1]: https://github.com/Moawiah188/d2-to-drawio/releases/tag/v1.0.1
[1.0.0]: https://github.com/Moawiah188/d2-to-drawio/releases/tag/v1.0.0
