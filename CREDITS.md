# CREDITS

This repository contains code taken from other projects, in addition to the
[Overleaf Community Edition](https://github.com/overleaf/overleaf) code base
itself.

## `services/web/modules/project-inspection` (Project Inspection)

Ported verbatim from the Overleaf Community Edition fork
[`hnd0hng/overleaf-cep`](https://github.com/hnd0hng/overleaf-cep).

- Source repository: `git@github.com:hnd0hng/overleaf-cep.git`
- Branch: `feature/project_inspection`
- Copied at commit: `0170f62b5a1260ca366adedcaec2e7d3bc7ae82d` (2026-11-05)
- Author: hnd0hng <hiendohoang07@gmail.com>

### Upstream commits that produced the module (oldest → newest)

| Commit | Date | Subject |
| --- | --- | --- |
| `18f3b0266b` | 2026-09-21 | feat: add project inspection module |
| `0a87be18f2` | 2026-09-22 | fix(project-inspection): distinguish dependency tree toggles |
| `c8608aedef` | 2026-09-22 | feat(project-inspection): add dependency tree item icons |
| `b4ff9e545f` | 2026-09-22 | Improve project inspection dependency tree |
| `d373e616b6` | 2026-09-22 | Align project inspection issue icons |
| `cca6f16f49` | 2026-09-22 | Remove duplicate citation inspection section |
| `a81fbc0aab` | 2026-09-23 | fix(project-inspection): align panel typography and status styling |
| `8a89d86506` | 2026-09-23 | feat(project-inspection): improve analysis results and responsive UI |
| `c92f8df6e6` | 2026-09-23 | fix(project-inspection): distinguish bibliography include icon |
| `fe3e62facb` | 2026-09-24 | feat(project-inspection): enhance dependency tree analysis |
| `55b2793b0e` | 2026-09-24 | feat(project-inspection): improve issue visibility and grouping |
| `a0a3cb9160` | 2026-09-24 | style(project-inspection): brighten unused status color |
| `27d39d2bf8` | 2026-09-25 | Improve project inspection UI responsiveness |
| `70767d3249` | 2026-09-28 | Detect duplicate figure/table captions and fix post-rebase bugs |
| `23ede8963a` | 2026-09-29 | Fix project inspection frontend compatibility and scrolling |

The module was registered in this fork's
`services/web/config/settings.defaults.js` (`railEntries` and
`moduleImportSequence`). One adaptation was required for this fork:
`services/web/package.json` moved `@lezer/highlight` and `@lezer/lr` from
devDependencies to dependencies — the analysis worker runs the lezer parsers
at Node runtime, which yarn PnP in production mode only resolves for
dependencies (this matches the layout in the upstream repository).

Also note: the lezer parsers consumed by the module (`lezer-latex/latex.mjs`,
`lezer-bibtex/bibtex.mjs`) are generated artifacts created by
`yarn lezer-latex:generate` (already part of this fork's build).
