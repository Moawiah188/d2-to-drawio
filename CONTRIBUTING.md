# Contributing

Thanks for helping improve d2-to-drawio.

## Dev setup

```
git clone https://github.com/Moawiah188/d2-to-drawio.git
cd d2-to-drawio
npm ci
npm test
```

Node 22 or newer. No build step; the package is plain ESM JavaScript.

Useful scripts:

- `npm test`: unit, snapshot, and CLI end-to-end tests.
- `npm run snapshots`: regenerate `test/snapshots/` after an intentional output change. Review the diff before committing; snapshot changes are part of the review surface.
- `npm run coverage`: test run with a coverage report.

## Adding or improving a feature mapping

Fixture first, then code, then the matrix:

1. Add a minimal `.d2` fixture under `test/fixtures/` that exercises the feature.
2. Run `npm run snapshots` and inspect the generated `.drawio` and `.warnings.txt`. If you can, open the output at https://app.diagrams.net or in draw.io desktop and eyeball it.
3. Implement the mapping in `src/map.js` (styles, dispatch) or `src/special.js` (structured labels). Unsupported aspects must warn through the warnings collector, never silently drop.
4. Update the matching row in `docs/FEATURE-MATRIX.md`. Every row corresponds to fixture-backed behavior.
5. `npm test` must be green, including the regenerated snapshots.

## Versioning policy

Strict semver:

- **Major**: breaking changes to the output format (existing input produces structurally different .drawio that could disrupt downstream diffs or tooling) or to the CLI/library contract.
- **Minor**: new feature support (a matrix row moving up: Unsupported to Partial, Partial to Full), new options.
- **Patch**: bug fixes that correct output toward documented behavior.

Snapshot churn caused by a dependency bump of `@terrastruct/d2` (layout changes) is a minor version, called out in the changelog.

## Commit style

Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`.
