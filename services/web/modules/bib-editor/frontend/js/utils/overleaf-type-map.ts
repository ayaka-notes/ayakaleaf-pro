/**
 * overleaf-type-map.ts — Overleaf reference-editor type vocabulary.
 *
 * Source of truth: the live overleaf.com captures (Phase C, 2026-08-22):
 * `bib_notes.txt` (48 Add-reference forms), `bibtypes_notes.txt` (48
 * @type blocks), `bib_style.html` (reference list style). 48/48 machine
 * types verified.
 *
 * Decision (PHASE_C_PLAN.md §3 C1): the 48 human labels, per-type form
 * main fields, and the 8-group optional-field taxonomy are DATA captured
 * verbatim (machine field names + English display strings), NOT i18n
 * keys — precedent: machine field names are not i18n'd either.
 */

export interface OverleafType {
  machine: string
  /** UI display label captured from the entry-type picker. */
  label: string
}

export interface FieldTaxonomyGroup {
  label: string
  fields: { label: string; field: string }[]
}

/** The 48 machine types (alphabetical) with the exact picker labels. */
export const OVERLEAF_TYPES: readonly OverleafType[] = [
  { machine: 'article', label: 'Article' },
  { machine: 'artwork', label: 'Artwork' },
  { machine: 'audio', label: 'Audio' },
  { machine: 'book', label: 'Book' },
  { machine: 'bookinbook', label: 'Book in book' },
  { machine: 'booklet', label: 'Booklet' },
  { machine: 'commentary', label: 'Commentary' },
  { machine: 'conference', label: 'Conference' },
  { machine: 'collection', label: 'Collection' },
  { machine: 'dataset', label: 'Dataset' },
  { machine: 'electronic', label: 'Electronic resource' },
  { machine: 'image', label: 'Image' },
  { machine: 'inbook', label: 'In book' },
  { machine: 'incollection', label: 'In collection' },
  { machine: 'inproceedings', label: 'In proceedings' },
  { machine: 'inreference', label: 'In reference' },
  { machine: 'jurisdiction', label: 'Jurisdiction' },
  { machine: 'legal', label: 'Legal' },
  { machine: 'legislation', label: 'Legislation' },
  { machine: 'letter', label: 'Letter' },
  { machine: 'manual', label: 'Manual' },
  { machine: 'mastersthesis', label: "Master's thesis" },
  { machine: 'misc', label: 'Miscellaneous' },
  { machine: 'movie', label: 'Movie' },
  { machine: 'mvbook', label: 'Multi-volume book' },
  { machine: 'mvcollection', label: 'Multi-volume collection' },
  { machine: 'mvproceedings', label: 'Multi-volume proceedings' },
  { machine: 'mvreference', label: 'Multi-volume reference' },
  { machine: 'music', label: 'Music' },
  { machine: 'online', label: 'Online resource' },
  { machine: 'patent', label: 'Patent' },
  { machine: 'performance', label: 'Performance' },
  { machine: 'periodical', label: 'Periodical' },
  { machine: 'phdthesis', label: 'PhD thesis' },
  { machine: 'proceedings', label: 'Proceedings' },
  { machine: 'reference', label: 'Reference' },
  { machine: 'report', label: 'Report' },
  { machine: 'review', label: 'Review' },
  { machine: 'software', label: 'Software' },
  { machine: 'standard', label: 'Standard' },
  { machine: 'suppbook', label: 'Supplemental material in book' },
  { machine: 'suppcollection', label: 'Supplemental material in collection' },
  { machine: 'suppperiodical', label: 'Supplemental material in periodical' },
  { machine: 'techreport', label: 'Tech report' },
  { machine: 'thesis', label: 'Thesis' },
  { machine: 'unpublished', label: 'Unpublished' },
  { machine: 'video', label: 'Video' },
  { machine: 'www', label: 'WWW' },
]

/** machine → display label (used by bib-types.ts `toLabel`). */
export const HUMAN_LABELS: Record<string, string> = Object.fromEntries(
  OVERLEAF_TYPES.map(t => [t.machine, t.label])
)

/**
 * Per-type form main fields, captured exactly from the 48 forms.
 *
 * Rows after the citation key, before Year/Date:
 *   Article: author, title, journal, journaltitle
 * ... (48/48 — see PHASE_C_PLAN.md §1.2 table; `CAPTURED_FORM_ROWS` below
 * mirrors it, including the post-Date rows: `unpublished` adds Note after
 * Date, `electronic`/`online`/`www` add doi/eprint/url after Date.)
 */
export interface CapturedFormShapes {
  // mainFields: rows after citation key, before Year
  // postDate:   rows after the Date row (empty for most types)
  mainFields: string[]
  postDate: string[]
}

export const CAPTURED_FORM_ROWS: Record<string, CapturedFormShapes> = {
  article: { mainFields: ['author', 'title', 'journal', 'journaltitle'], postDate: [] },
  artwork: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  audio: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  book: { mainFields: ['author', 'editor', 'title', 'publisher'], postDate: [] },
  bookinbook: { mainFields: ['author', 'editor', 'title', 'booktitle', 'chapter', 'pages', 'publisher'], postDate: [] },
  booklet: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  commentary: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  conference: { mainFields: ['author', 'title', 'booktitle'], postDate: [] },
  collection: { mainFields: ['editor', 'title'], postDate: [] },
  dataset: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  electronic: { mainFields: ['author', 'editor', 'title'], postDate: ['doi', 'eprint', 'url'] },
  image: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  inbook: { mainFields: ['author', 'editor', 'title', 'booktitle', 'chapter', 'pages', 'publisher'], postDate: [] },
  incollection: { mainFields: ['author', 'title', 'booktitle', 'publisher'], postDate: [] },
  inproceedings: { mainFields: ['author', 'title', 'booktitle'], postDate: [] },
  inreference: { mainFields: ['author', 'editor', 'title', 'booktitle'], postDate: [] },
  jurisdiction: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  legal: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  legislation: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  letter: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  manual: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  mastersthesis: { mainFields: ['author', 'title', 'institution', 'school'], postDate: [] },
  misc: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  movie: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  mvbook: { mainFields: ['author', 'title'], postDate: [] },
  mvcollection: { mainFields: ['editor', 'title'], postDate: [] },
  mvproceedings: { mainFields: ['title'], postDate: [] },
  mvreference: { mainFields: ['editor', 'title'], postDate: [] },
  music: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  online: { mainFields: ['author', 'editor', 'title'], postDate: ['doi', 'eprint', 'url'] },
  patent: { mainFields: ['author', 'title', 'number'], postDate: [] },
  performance: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  periodical: { mainFields: ['editor', 'title'], postDate: [] },
  phdthesis: { mainFields: ['author', 'title', 'institution', 'school'], postDate: [] },
  proceedings: { mainFields: ['title'], postDate: [] },
  reference: { mainFields: ['editor', 'title'], postDate: [] },
  report: { mainFields: ['author', 'title', 'type', 'institution'], postDate: [] },
  review: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  software: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  standard: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  suppbook: { mainFields: ['author', 'editor', 'title', 'booktitle', 'chapter', 'pages', 'publisher'], postDate: [] },
  suppcollection: { mainFields: ['author', 'editor', 'title', 'booktitle'], postDate: [] },
  suppperiodical: { mainFields: ['author', 'title', 'journaltitle'], postDate: [] },
  techreport: { mainFields: ['author', 'title', 'institution'], postDate: [] },
  thesis: { mainFields: ['author', 'title', 'type', 'institution'], postDate: [] },
  unpublished: { mainFields: ['author', 'title'], postDate: ['note'] },
  video: { mainFields: ['author', 'editor', 'title'], postDate: [] },
  www: { mainFields: ['author', 'editor', 'title'], postDate: ['doi', 'eprint', 'url'] },
}

/**
 * The 8 groups offered by the live "Add optional field" combobox
 * (bib_style.html — 63 options, capture-verified group order + content).
 */
export const OPTIONAL_FIELD_TAXONOMY: readonly FieldTaxonomyGroup[] = [
  {
    label: 'Common',
    fields: [
      { label: 'Abstract', field: 'abstract' },
      { label: 'Subtitle', field: 'subtitle' },
      { label: 'Title addon', field: 'titleaddon' },
      { label: 'Language', field: 'language' },
      { label: 'Note', field: 'note' },
      { label: 'Addendum', field: 'addendum' },
      { label: 'Publication state', field: 'pubstate' },
    ],
  },
  {
    label: 'Contributors',
    fields: [
      { label: 'Editor', field: 'editor' },
      { label: 'Editor A', field: 'editora' },
      { label: 'Editor B', field: 'editorb' },
      { label: 'Editor C', field: 'editorc' },
      { label: 'Translator', field: 'translator' },
      { label: 'Annotator', field: 'annotator' },
      { label: 'Commentator', field: 'commentator' },
      { label: 'Introduction', field: 'introduction' },
      { label: 'Foreword', field: 'foreword' },
      { label: 'Afterword', field: 'afterword' },
      { label: 'Book author', field: 'bookauthor' },
      { label: 'Holder', field: 'holder' },
    ],
  },
  {
    label: 'Books and volumes',
    fields: [
      { label: 'Main title', field: 'maintitle' },
      { label: 'Main subtitle', field: 'mainsubtitle' },
      { label: 'Main title addon', field: 'maintitleaddon' },
      { label: 'Book title', field: 'booktitle' },
      { label: 'Book subtitle', field: 'booksubtitle' },
      { label: 'Book title addon', field: 'booktitleaddon' },
      { label: 'Volume', field: 'volume' },
      { label: 'Volumes', field: 'volumes' },
      { label: 'Part', field: 'part' },
      { label: 'Edition', field: 'edition' },
      { label: 'Chapter', field: 'chapter' },
      { label: 'Pages', field: 'pages' },
      { label: 'Page total', field: 'pagetotal' },
      { label: 'EID', field: 'eid' },
    ],
  },
  {
    label: 'Periodicals and journals',
    fields: [
      { label: 'Journal title', field: 'journaltitle' },
      { label: 'Journal subtitle', field: 'journalsubtitle' },
      { label: 'Journal title addon', field: 'journaltitleaddon' },
      { label: 'Issue title', field: 'issuetitle' },
      { label: 'Issue subtitle', field: 'issuesubtitle' },
      { label: 'Issue title addon', field: 'issuetitleaddon' },
      { label: 'Issue', field: 'issue' },
    ],
  },
  {
    label: 'Events and conferences',
    fields: [
      { label: 'Event title', field: 'eventtitle' },
      { label: 'Event title addon', field: 'eventtitleaddon' },
      { label: 'Event date', field: 'eventdate' },
      { label: 'Venue', field: 'venue' },
    ],
  },
  {
    label: 'Publication details',
    fields: [
      { label: 'Publisher', field: 'publisher' },
      { label: 'Location', field: 'location' },
      { label: 'Organization', field: 'organization' },
      { label: 'Institution', field: 'institution' },
      { label: 'Series', field: 'series' },
      { label: 'Number', field: 'number' },
      { label: 'Type', field: 'type' },
      { label: 'Version', field: 'version' },
      { label: 'Month', field: 'month' },
      { label: 'ISBN', field: 'isbn' },
      { label: 'ISSN', field: 'issn' },
      { label: 'ISRN', field: 'isrn' },
      { label: 'How published', field: 'howpublished' },
    ],
  },
  {
    label: 'Digital and online',
    fields: [
      { label: 'Digital object identifier (DOI)', field: 'doi' },
      { label: 'Eprint', field: 'eprint' },
      { label: 'Eprint class', field: 'eprintclass' },
      { label: 'Eprint type', field: 'eprinttype' },
      { label: 'URL', field: 'url' },
      { label: 'URL date', field: 'urldate' },
    ],
  },
  {
    label: 'Language and origin',
    fields: [
      { label: 'Original language', field: 'origlanguage' },
    ],
  },
]

/**
 * Humanized preview heading, per capture ("Ernst et al. (2007)"): first
 * author (or editor) surname ("Last, First" BibTeX form handled),
 * " et al." when more than one author, year in parentheses when present.
 * Falls back to the citation key, then to "Unknown".
 */
export function humanizeCitationHeading(
  id: string,
  fields: Record<string, string>
): string {
  const people = fields.author?.trim() || fields.editor?.trim() || ''
  const authors = people
    .split(/\s+and\s+/i)
    .map(a => a.trim())
    .filter(Boolean)
  const who: string = (() => {
    if (authors.length > 0) {
      const first = authors[0]
      const hasComma = first.includes(',')
      const surname = hasComma
        ? (first.split(',')[0] || '').trim() || first
        : first.lastIndexOf(' ') >= 0
          ? first.slice(first.lastIndexOf(' ') + 1).trim()
          : first
      return authors.length > 1 ? `${surname} et al.` : surname
    }
    return id && id.trim().length > 0 ? id.trim() : 'Unknown'
  })()
  const year = fields.year?.trim() || (fields.date?.trim() || '').slice(0, 4)
  return year ? `${who} (${year})` : who
}

/**
 * Optional fields the "Add optional field" combobox offers for a machine
 * type: the 8-group taxonomy minus the current type's captured form rows
 * (mainFields + postDate), minus Year/Date, minus its requiredFields
 * members. (Capture: Article does NOT offer Journal/Journal title but DOES
 * offer Journal subtitle.)
 */
export function offeredOptionalFields(
  machine: string,
  requiredFields: Array<string | string[]> = []
): { label: string; field: string; group: string }[] {
  const shape = CAPTURED_FORM_ROWS[machine.toLowerCase()]
  const excluded = new Set<string>([
    ...(shape?.mainFields ?? []),
    ...(shape?.postDate ?? []),
    'year',
    'date',
  ])
  for (const r of requiredFields) {
    for (const f of (Array.isArray(r) ? r : [r])) excluded.add(f)
  }
  const offered: { label: string; field: string; group: string }[] = []
  for (const group of OPTIONAL_FIELD_TAXONOMY) {
    for (const f of group.fields) {
      if (!excluded.has(f.field)) {
        offered.push({ label: f.label, field: f.field, group: group.label })
      }
    }
  }
  return offered
}
