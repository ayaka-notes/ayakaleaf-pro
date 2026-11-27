# BibTeX field / entry-type reference — bib-editor

Extracted 2026-08-20 (sequential, file-backed). Purpose: pin the
required/optional fields per entry type and drive the "common fields
visible by default" decision (§2.6 of the plan) and the `misc`/`manual` gap
finding.

## 0. TL;DR — what the sources actually told us

1. **The reference `bibtex-schema.json` you provided is byte-identical to
   `frontend/js/utils/bibtex-schema.json`** (the module's own schema). Source:
   `@citation-js/plugin-bibtex 0.8.2`. So there is **no external schema to
   merge** — the module's schema is already the citation-js 0.8.2 schema, and
   the 145-fields-per-type bloat is intrinsic to that upstream file. The
   "fewer fields visible" fix therefore can **not** come from a different
   upstream JSON; it must come from us shipping a **separate, small
   per-type `defaultOptionalFields`** list (see plan §2.6) and keeping the
   full citation-js file for "Show all fields".
2. **Patashnik `btxdoc` (BibTeX 0.99b)** — the authoritative compact
   required/optional table per type. This is the list we should use for
   *default-visible* and *required* semantics (it matches our schema's
   `requiredFields` exactly for the shared types).
3. **citation.js.org** — project site; the substantive BibTeX data is in
   `@citation-js/plugin-bibtex` (npm / github infracode/citation.js), which is
   *the same* as item 1. Nothing new to extract beyond §1.

## 1. Patashnik / btxdoc — canonical standard-style table

Field classes (btxdoc §3.1): **required** (omit → warning, rarely bad output),
**optional** (used if present), **ignored** (BibTeX ignores any field not
required/optional, so keep all info in the .bib). Each type also has an
optional `key` field (NOT the citation key; used for alphabetizing).

| type | required | optional (default-visible) |
|---|---|---|
| `article` | author, title, journal, year | volume, number, pages, month, note |
| `book` | author **or** editor, title, publisher, year | volume **or** number, series, address, edition, month, note |
| `booklet` | title | author, howpublished, address, month, year, note |
| `inbook` | author **or** editor, title, chapter **and/or** pages, publisher, year | volume **or** number, series, type, address, edition, month, note |
| `incollection` | author, title, booktitle, publisher, year | editor, volume **or** number, series, type, chapter, pages, address, edition, month, note |
| `inproceedings` | author, title, booktitle, year | editor, volume **or** number, series, pages, address, month, organization, publisher, note |
| `manual` | title | author, organization, address, edition, month, year, note |
| `mastersthesis` | author, title, school, year | type, address, month, note |
| `misc` | (none) | author, title, howpublished, month, year, note |
| `proceedings` | title, year | editor, volume **or** number, series, address, month, organization, publisher, note |
| `techreport` | author, title, institution, year | type, number, address, month, note |
| `unpublished` | author, title, note | month, year |
| `conference` | (= `inproceedings`) | same | (Scribe-compat alias; no own table) |

Notes from btxdoc §2/§4 worth encoding:
- `inbook` requires `chapter and/or pages` → our schema's
  `["chapter","pages"]` OR-group is correct.
- `book`/`inbook`/`incollection` require `author **or** editor` → our
  `["author","editor"]` group is correct (this is where the rendered
  `authoreditor` pseudo-field bug came from — confirmed §3.2 of the plan).
- `volume or number` is a **soft** optional (either, or neither) → not a
  required OR-group; do **not** star it in validation.
- `misc` has **no** required fields (all optional) — the reviewer's red-frame
  behavior should let `misc` be valid with just a key.
- `month` should be the 3-letter abbreviation (Jan, Feb, …) per Appendix B.1.3.
- `key` field ≠ citation key (Scribe-compat). We currently ignore it in the
  form (it's in `allKnownFields`, shown only via "Show all fields").

## 2. Gap found: entry types we don't offer

Our `supportedPublicationTypes` = 11 types:
`article, book, booklet, inbook, incollection, inproceedings, mastersthesis,
phdthesis, proceedings, techreport, unpublished`.

btxdoc's standard set adds three we are **missing** from the type dropdown:
- `misc` (very common — this is what upstream commit `4156d6e1` "Remove
  parasitic @misc" is about; users create `@misc` constantly)
- `manual`
- `conference` (alias of `inproceedings`; may skip)

**Recommendation (§2.5 of the plan, D6):** add `misc` (and `manual`) to
`supportedPublicationTypes` + their per-type rules in our schema. `misc` is
required-by-none → validates with just a key; this is what makes the "incomplete
entry with red frame" flow meaningful for the reviewer's "no real Add/Edit
distinction" goal. `conference` can be deferred (alias).

## 3. Recommended per-type "default visible optional" (§2.6 final)

Ship a **small** list (NOT the 145-field citation-js lists). Proposal, from the
btxdoc optional column minus the noisy ones, so the form is sane for *new*
entries; existing entries still show any field that already has a value, and
"Show all fields" reveals the rest from the full citation-js schema:

| type | default-visible optional (beyond required) |
|---|---|
| article | volume, number, pages, month, note, doi, url, eprint |
| book | series, address, edition, month, note, series, isbn, publisher |
| booklet | author, howpublished, address, month, year, note |
| inbook | series, type, address, edition, month, note, publisher |
| incollection | editor, series, chapter, pages, address, edition, month, note, doi |
| inproceedings | editor, series, pages, address, month, organization, publisher, note, doi |
| mastersthesis | type, address, month, note, url |
| phdthesis | type, address, month, note, url |
| proceedings | editor, series, address, month, organization, publisher, note |
| techreport | type, number, address, month, note, url |
| unpublished | month, year, note, url |
| misc (new) | author, title, howpublished, month, year, note, doi, url, publisher |

(`doi`/`url`/`eprint`/`isbn` are added on top of btxdoc because DOI import and
URL are core reviewer features; they are low-noise and high-use.)

Implementation note: this is a **new** key `defaultOptionalFields` per type in
`bibtex-schema.json`, **not** a rewrite of `optionalFields`. Keep
`optionalFields` + `allKnownFields` (full citation-js) intact so "Show all
fields" is unchanged and upstream-mergeable.

## 4. Field-name normalization & extras

- All BibTeX field names are case-insensitive; canonical lowercase (we already
  lowercase in the parser `parseFields` and `bibtex-schema`).
- Fields in citation-js `allKnownFields` that are NOT in btxdoc's standard 22
  (e.g. `annotator`, `annote`, `archiveprefix`, `afterword`, `maintitle`,
  `language`, `isbn`, `eprint`, `keywords`, `file`) are valid BibLaTeX/extended
  fields — keep them in `allKnownFields` for "Show all fields"; never default.
- Author values are `Last, First and Last, First` (the `and` is the separator;
  our `AuthorField` already handles this).
- Numeric-ish: `volume`, `number`, `pages`, `year` (4-digit), `month`.

## 5. Sources
- Patashnik, *BIBTEXing* (btxdoc.pdf), BibTeX 0.99b, §3 entry types/fields,
  §2 field-change notes, §4 hints. 115 KB PDF → `/tmp/btxdoc.txt` (pdftotext).
  URL: https://www.ntg.nl/literatuur/patashnik/btxdoc.pdf
- citation.js: project https://citation.js.org/ ; data via
  `@citation-js/plugin-bibtex` (infracode/citation.js) = module's
  `bibtex-schema.json` (unchanged).
- Reference attachment `...files/30290864/bibtex-schema.json` ≡ module schema
  (identical), i.e. the citation-js 0.8.2 file.
