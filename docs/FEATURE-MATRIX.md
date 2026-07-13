# D2 feature support matrix

How to read this table:

- **Full**: the feature converts to a faithful, editable draw.io equivalent.
- **Partial**: the feature converts, with a stated loss. The converter still succeeds.
- **Unsupported**: the feature does not convert. The converter degrades gracefully (closest visual, one warning line on stderr) and `--strict` turns it into a failure.
- **Out of scope**: the feature belongs to D2's renderer or toolchain, not to a structural conversion, with reasoning.

The degradation contract: no D2 input that the official compiler accepts will ever crash the converter. Unsupported styling degrades to the closest visual with a warning; unknown shapes become labeled rectangles.

How this table was verified: every row cites behavior exercised by a fixture in `test/fixtures/` (37 fixtures at the time of writing). All fixture outputs are structurally validated with a real XML parser against the draw.io format contract (see "Format contract" below), and 35 of 37 were additionally exported through draw.io desktop 29.3.0 as a does-it-really-open check (the remaining 2 are intentionally empty diagrams, which draw.io opens but refuses to export). Positions come from the official D2 compiler's layout, so anything the compiler positions is positioned here.

Because the converter uses the official D2 compiler (`@terrastruct/d2`), everything the compiler resolves before layout works without any converter code: vars, substitutions, globs, classes, imports, overrides, `null` deletion, suspend/unsuspend. These rows are Full by construction.

## Shapes

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| rectangle, square | Full | `rounded=1` when `border-radius` is set | feat-shapes |
| page | Full | draw.io `note` (folded corner) | feat-shapes |
| parallelogram | Full | | feat-shapes |
| document | Full | | feat-shapes |
| cylinder | Full | draw.io `cylinder3` | feat-shapes |
| queue | Full | horizontal cylinder (`direction=north`) | feat-shapes |
| package | Full | draw.io `folder` with tab | feat-shapes |
| step | Full | | feat-shapes |
| callout | Full | | feat-shapes |
| stored_data | Full | draw.io `dataStorage` | feat-shapes |
| person | Full | draw.io `actor` | feat-shapes |
| c4-person | Partial | renders as a generic actor, not the C4 boxed figure | feat-shapes |
| diamond | Full | `rhombus` | feat-shapes |
| oval, circle | Full | circle keeps its 1:1 size from layout | feat-shapes |
| hexagon | Full | | feat-shapes |
| cloud | Full | | feat-shapes |
| image (`shape: image`) | Full | `shape=image` with the icon URL, label below | feat-icons |
| text (`shape: text`) | Full | borderless text vertex | text-title, feat-text-blocks |
| sql_table | Partial | one shape with a formatted header + column rows and PK/FK/UNQ tags; rows are not individually editable table cells | feat-sql-class |
| class (UML) | Partial | one shape with visibility-prefixed fields and methods; not separate row cells | feat-sql-class |
| sequence_diagram | Partial | actors, spans, messages, and lifelines all render at d2's positions; messages and lifelines are fixed geometry and do not re-route when shapes move | feat-sequence |

## Connections

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| `->`, `<-`, `<->`, `--` | Full | direction expressed via start/end arrows | feat-arrowheads |
| chained connections (`a -> b -> c`) | Full | compiler splits them into single edges | feat-arrowheads |
| connection labels | Full | | edge-labels |
| repeated/parallel connections | Full | each declaration is its own edge | adv-parallel-edges |
| self-loops (`a -> a`) | Full | | adv-self-loop |
| connection references (`(a -> b)[0]`) | Full | resolved by the compiler | feat-vars-globs-classes |
| arrowheads: triangle, arrow, diamond, circle, box, cross (+ filled variants) | Full | mapped to block/classicThin/diamond/oval/box/cross with matching fill | feat-arrowheads |
| crow's foot arrowheads (`cf-one`, `cf-one-required`, `cf-many`, `cf-many-required`) | Full | draw.io ER markers (ERone, ERmandOne, ERzeroToMany, ERoneToMany) | feat-arrowheads |
| arrowhead labels | Full | standard draw.io edge-label children near each end | feat-arrowheads |
| connection styling (stroke, stroke-width, stroke-dash, opacity, font) | Full | | feat-styles |
| `border-radius` on connections (curve rounding) | Partial | orthogonal routing stays sharp unless `--waypoints` preserves the curve flag | feat-styles |
| edge routing | Full by default, exact with `--waypoints` | default lets draw.io re-route orthogonally (editable); `--waypoints` pins d2's computed route | any |

## Styles

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| fill, stroke (hex, CSS names, `transparent`) | Full | literals pass through, theme codes resolve against the verified palette | feat-styles |
| stroke-width | Full | | feat-styles |
| stroke-dash | Full | `dashed=1` with a matching `dashPattern` | feat-styles |
| border-radius | Partial | draw.io `rounded=1`; the exact radius value is not carried over | feat-styles |
| opacity | Full | 0..1 mapped to 0..100 | feat-styles |
| shadow | Full | | feat-styles |
| font-size, font-color | Full | | feat-styles |
| bold, italic, underline | Full | draw.io fontStyle bitmask | feat-styles |
| font: mono | Full | Courier New | feat-text-blocks |
| multiple | Unsupported | warned and ignored; draw.io has no stacked-copies style | feat-styles |
| 3d | Unsupported | warned and ignored | feat-styles |
| double-border | Unsupported | warned and ignored | feat-styles |
| fill-pattern | Unsupported | warned and ignored | feat-styles |
| animated | Unsupported | warned and ignored; static file format | feat-styles |
| text-transform | Unsupported | the compiler IR does not carry it, so it is lost without a warning | feat-styles |
| root-level `style.fill` (diagram background) | Full | page background color | feat-styles |
| other root-level frame styles (stroke, double-border) | Unsupported | silently ignored | |

## Containers and layout

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| containers (dot notation and nested maps) | Full | draw.io containers, children in parent coordinates, tested 6 levels deep | basic, adv-deep-nesting |
| container labels | Full | shown inside the top edge (d2 draws them above; documented approximation) | multi-zone |
| parent references (`_`) | Full | compiler-resolved | |
| `direction` | Full | baked into the compiler's layout positions | feat-near-direction |
| `near` (constants) | Full | positions come from layout, including negative coordinates | feat-near-direction |
| `label.near` / `icon.near` | Partial | inside positions map to draw.io alignment; outside positions approximate | feat-near-direction |
| explicit `width` / `height` | Full | | feat-near-direction |
| `top` / `left` (TALA only) | Out of scope | the embedded compiler ships dagre and ELK only; TALA is rejected with a clear error | |
| grid diagrams (grid-rows, grid-columns, gaps) | Full | grid cells arrive as positioned children | feat-grid |
| layout engines | Full | `--layout dagre` (default) or `--layout elk` | any |

## Text and labels

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| unquoted, quoted, escaped labels | Full | XML-hostile characters double-escaped correctly for html labels | adv-xml-hostile |
| multi-line labels (`\n`) | Full | `<br>` in html labels | adv-multiline |
| unicode, emoji, RTL text | Full | Arabic, CJK, emoji verified in rendered output | adv-unicode-rtl |
| markdown blocks | Partial | rendered as plain text with a warning; formatting characters stay literal | feat-text-blocks |
| LaTeX blocks | Partial | wrapped in `$$...$$` with the page's math mode on; draw.io MathJax dialect differences may affect edge cases | feat-text-blocks |
| code blocks | Partial | monospace box; no syntax highlighting | feat-text-blocks |

## Interactive

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| tooltip | Full | draw.io cell tooltip (hover) | feat-interactive |
| link (external URL) | Full | draw.io cell link | feat-interactive |
| link to boards (`layers.x`) | Unsupported | kept as literal link text with a warning; does not navigate between pages | feat-layers |
| icons on regular shapes | Unsupported | warned and dropped; only `shape: image` carries an image | feat-icons |

## Language features (compiler-level, Full by construction)

| Feature | Status | Fixture |
|---|---|---|
| comments (`#`, block) | Full | adv-comments-only |
| vars and substitutions | Full | feat-vars-globs-classes |
| `d2-config` (theme-id, layout honored unless overridden by flags) | Full | |
| classes (including class arrays) | Full | feat-vars-globs-classes |
| globs (`*`, `**`, filters) | Full | feat-vars-globs-classes |
| imports (`@file`, `...@spread`, partial) | Full; the CLI feeds sibling `.d2` files to the compiler | basic |
| overrides and `null` deletion | Full | adv-duplicate-keys |
| suspend / unsuspend | Full | |
| quoted keys containing dots | Full | adv-quoted-dots |
| duplicate key merging | Full | adv-duplicate-keys |

## Composition

| Feature | Status | Notes | Fixture |
|---|---|---|---|
| layers | Full | one draw.io page per board, named after the board | feat-layers |
| scenarios | Full | pages (inheriting base content, per D2 semantics) | feat-layers |
| steps | Full | pages | |
| nested boards | Full | recursive page collection | |
| `d2-legend` | Unsupported | the IR exposes it but no legend is synthesized yet | |

## Themes and rendering

| Feature | Status | Notes |
|---|---|---|
| themes (`--theme <id>`) | Full | all 20 official theme palettes extracted from the D2 source and verified against live renders |
| dark-theme-id | Out of scope | a render-time concern; convert twice with two themes if needed |
| theme-overrides | Unsupported | palette codes resolve to the stock palette; per-diagram overrides are ignored |
| sketch mode | Unsupported | not mapped to draw.io's sketch style yet (roadmap) |
| custom fonts | Out of scope | renderer feature |
| animated exports, multi-page PDF/PPTX | Out of scope | export formats of the d2 CLI, not file conversion |

## Robustness (adversarial fixtures)

| Case | Result | Fixture |
|---|---|---|
| XML-hostile labels (`&`, `<`, `>`, quotes, `]]>`) | correct double escaping, verified rendering | adv-xml-hostile |
| empty file | valid empty page (draw.io opens it; export of an empty page is refused by draw.io itself) | adv-empty |
| comments-only file | valid empty page | adv-comments-only |
| CRLF line endings | converts | adv-crlf |
| UTF-8 BOM | stripped, converts | adv-bom |
| disconnected components | converts | adv-disconnected |
| deep nesting with edges into level 6 | converts | adv-deep-nesting |
| ~500 shapes, ~474 edges | converts in about 9 seconds end to end on the reference machine (most of it layout) | perf-500 |

## Format contract

Every output satisfies, and the test suite enforces:

- `mxfile > diagram > mxGraphModel > root`, one `diagram` element per board
- root cells `id="0"` and `id="1"` (parent `0`)
- every vertex has an `mxGeometry` with numeric x/y/width/height (edge-label children use relative geometry, as draw.io itself does)
- every edge either references existing source and target cells or carries fixed `sourcePoint`/`targetPoint` geometry
- every cell's parent exists; container children use parent-relative coordinates
- uncompressed XML, byte-identical across runs for identical input

The contract was verified against the official draw.io generation docs, the mxfile XSD from jgraph/drawio-mcp, mxGraph API documentation, drawio source, and a hand-decompressed app-authored reference file from jgraph/drawio-diagrams.
