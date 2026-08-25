// BibTeX field schema: per entry-type field lists and per-field metadata.
// `requiredFields` entries may be alternatives (a string[] means "any one of").
// Generated data table — do not hand-edit.

export type FieldAlternatives = string | string[]

export interface EntryTypeSchema {
  key: string
  label: string
  fields: string[]
  requiredFields: FieldAlternatives[]
  optionalFields: string[]
}

export interface FieldMeta {
  key: string
  label: string
  helperText: string
}

const ENTRY_TYPES: Record<string, EntryTypeSchema> = {
  "article": {
    "key": "article",
    "label": "Article",
    "fields": [
      "author",
      "title",
      "journal",
      "journaltitle",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      [
        "journal",
        "journaltitle"
      ],
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": [
      "translator",
      "annotator",
      "commentator",
      "subtitle",
      "titleaddon",
      "editor",
      "editora",
      "editorb",
      "editorc",
      "journalsubtitle",
      "journaltitleaddon",
      "issuetitle",
      "issuesubtitle",
      "issuetitleaddon",
      "language",
      "origlanguage",
      "series",
      "volume",
      "number",
      "eid",
      "issue",
      "month",
      "pages",
      "version",
      "note",
      "issn",
      "addendum",
      "pubstate",
      "doi",
      "eprint",
      "eprintclass",
      "eprinttype",
      "url",
      "urldate"
    ]
  },
  "artwork": {
    "key": "artwork",
    "label": "Artwork",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "audio": {
    "key": "audio",
    "label": "Audio",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "book": {
    "key": "book",
    "label": "Book",
    "fields": [
      "author",
      "editor",
      "title",
      "publisher",
      "year",
      "date"
    ],
    "requiredFields": [
      [
        "author",
        "editor"
      ],
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "bookinbook": {
    "key": "bookinbook",
    "label": "Book in book",
    "fields": [
      "author",
      "editor",
      "title",
      "booktitle",
      "chapter",
      "pages",
      "publisher",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "booklet": {
    "key": "booklet",
    "label": "Booklet",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "title"
    ],
    "optionalFields": []
  },
  "commentary": {
    "key": "commentary",
    "label": "Commentary",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "conference": {
    "key": "conference",
    "label": "Conference",
    "fields": [
      "author",
      "title",
      "booktitle",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "collection": {
    "key": "collection",
    "label": "Collection",
    "fields": [
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "editor",
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "dataset": {
    "key": "dataset",
    "label": "Dataset",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      [
        "author",
        "editor"
      ],
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "electronic": {
    "key": "electronic",
    "label": "Electronic resource",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date",
      "doi",
      "eprint",
      "url"
    ],
    "requiredFields": [
      [
        "author",
        "editor"
      ],
      "title",
      [
        "year",
        "date"
      ],
      [
        "doi",
        "eprint",
        "url"
      ]
    ],
    "optionalFields": []
  },
  "image": {
    "key": "image",
    "label": "Image",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "inproceedings": {
    "key": "inproceedings",
    "label": "In proceedings",
    "fields": [
      "author",
      "title",
      "booktitle",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "inbook": {
    "key": "inbook",
    "label": "In book",
    "fields": [
      "author",
      "editor",
      "title",
      "booktitle",
      "chapter",
      "pages",
      "publisher",
      "year",
      "date"
    ],
    "requiredFields": [
      [
        "author",
        "editor"
      ],
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "incollection": {
    "key": "incollection",
    "label": "In collection",
    "fields": [
      "author",
      "title",
      "booktitle",
      "publisher",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "inreference": {
    "key": "inreference",
    "label": "In reference",
    "fields": [
      "author",
      "editor",
      "title",
      "booktitle",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "editor",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "jurisdiction": {
    "key": "jurisdiction",
    "label": "Jurisdiction",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "manual": {
    "key": "manual",
    "label": "Manual",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "title"
    ],
    "optionalFields": []
  },
  "mastersthesis": {
    "key": "mastersthesis",
    "label": "Master's thesis",
    "fields": [
      "author",
      "title",
      "institution",
      "school",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      [
        "school",
        "institution"
      ],
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "misc": {
    "key": "misc",
    "label": "Miscellaneous",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "movie": {
    "key": "movie",
    "label": "Movie",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "music": {
    "key": "music",
    "label": "Music",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "mvbook": {
    "key": "mvbook",
    "label": "Multi-volume book",
    "fields": [
      "author",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "mvcollection": {
    "key": "mvcollection",
    "label": "Multi-volume collection",
    "fields": [
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "editor",
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "mvproceedings": {
    "key": "mvproceedings",
    "label": "Multi-volume proceedings",
    "fields": [
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "mvreference": {
    "key": "mvreference",
    "label": "Multi-volume reference",
    "fields": [
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "editor",
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "legal": {
    "key": "legal",
    "label": "Legal",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "legislation": {
    "key": "legislation",
    "label": "Legislation",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "letter": {
    "key": "letter",
    "label": "Letter",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "online": {
    "key": "online",
    "label": "Online resource",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date",
      "doi",
      "eprint",
      "url"
    ],
    "requiredFields": [
      [
        "author",
        "editor"
      ],
      "title",
      [
        "year",
        "date"
      ],
      [
        "doi",
        "eprint",
        "url"
      ]
    ],
    "optionalFields": []
  },
  "patent": {
    "key": "patent",
    "label": "Patent",
    "fields": [
      "author",
      "title",
      "number",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "number",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "performance": {
    "key": "performance",
    "label": "Performance",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "periodical": {
    "key": "periodical",
    "label": "Periodical",
    "fields": [
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "editor",
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "phdthesis": {
    "key": "phdthesis",
    "label": "PhD thesis",
    "fields": [
      "author",
      "title",
      "institution",
      "school",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      [
        "school",
        "institution"
      ],
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "proceedings": {
    "key": "proceedings",
    "label": "Proceedings",
    "fields": [
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "reference": {
    "key": "reference",
    "label": "Reference",
    "fields": [
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [
      "editor",
      "title",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "report": {
    "key": "report",
    "label": "Report",
    "fields": [
      "author",
      "title",
      "type",
      "institution",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "type",
      "institution",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "review": {
    "key": "review",
    "label": "Review",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "software": {
    "key": "software",
    "label": "Software",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "standard": {
    "key": "standard",
    "label": "Standard",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "suppbook": {
    "key": "suppbook",
    "label": "Supplemental material in book",
    "fields": [
      "author",
      "editor",
      "title",
      "booktitle",
      "chapter",
      "pages",
      "publisher",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "suppcollection": {
    "key": "suppcollection",
    "label": "Supplemental material in collection",
    "fields": [
      "author",
      "editor",
      "title",
      "booktitle",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "editor",
      "booktitle",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "suppperiodical": {
    "key": "suppperiodical",
    "label": "Supplemental material in periodical",
    "fields": [
      "author",
      "title",
      "journaltitle",
      "year",
      "date"
    ],
    "optionalFields": [],
    "requiredFields": [
      "author",
      "title",
      "journaltitle",
      [
        "year",
        "date"
      ]
    ]
  },
  "techreport": {
    "key": "techreport",
    "label": "Tech report",
    "fields": [
      "author",
      "title",
      "institution",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "institution",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "thesis": {
    "key": "thesis",
    "label": "Thesis",
    "fields": [
      "author",
      "title",
      "type",
      "institution",
      "year",
      "date"
    ],
    "requiredFields": [
      "author",
      "title",
      "type",
      "institution",
      [
        "year",
        "date"
      ]
    ],
    "optionalFields": []
  },
  "unpublished": {
    "key": "unpublished",
    "label": "Unpublished",
    "fields": [
      "author",
      "title",
      "year",
      "date",
      "note"
    ],
    "requiredFields": [
      "author",
      "title"
    ],
    "optionalFields": []
  },
  "video": {
    "key": "video",
    "label": "Video",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date"
    ],
    "requiredFields": [],
    "optionalFields": []
  },
  "www": {
    "key": "www",
    "label": "WWW",
    "fields": [
      "author",
      "editor",
      "title",
      "year",
      "date",
      "doi",
      "eprint",
      "url"
    ],
    "requiredFields": [
      [
        "author",
        "editor"
      ],
      "title",
      [
        "year",
        "date"
      ],
      [
        "doi",
        "eprint",
        "url"
      ]
    ],
    "optionalFields": []
  }
}

const FIELDS: Record<string, FieldMeta> = {
  "address": {
    "key": "address",
    "label": "Address",
    "helperText": "Place of publication or event location"
  },
  "annote": {
    "key": "annote",
    "label": "Annote",
    "helperText": "Annotation for the entry"
  },
  "author": {
    "key": "author",
    "label": "Author",
    "helperText": "Separate multiple names with \"and\""
  },
  "booktitle": {
    "key": "booktitle",
    "label": "Book title",
    "helperText": ""
  },
  "chapter": {
    "key": "chapter",
    "label": "Chapter",
    "helperText": ""
  },
  "crossref": {
    "key": "crossref",
    "label": "Cross reference",
    "helperText": "Citation key of a related entry"
  },
  "date": {
    "key": "date",
    "label": "Date",
    "helperText": ""
  },
  "doi": {
    "key": "doi",
    "label": "Digital object identifier (DOI)",
    "helperText": "The identifier only, not the full URL, e.g. 10.1000/xyz123"
  },
  "edition": {
    "key": "edition",
    "label": "Edition",
    "helperText": ""
  },
  "editor": {
    "key": "editor",
    "label": "Editor",
    "helperText": "Separate multiple names with \"and\""
  },
  "eprint": {
    "key": "eprint",
    "label": "Eprint",
    "helperText": "The preprint archive identifier, e.g. math/0307200v3"
  },
  "howpublished": {
    "key": "howpublished",
    "label": "How published",
    "helperText": "How the work was made available, e.g. Poster presentation or Self-published"
  },
  "institution": {
    "key": "institution",
    "label": "Institution",
    "helperText": ""
  },
  "journal": {
    "key": "journal",
    "label": "Journal",
    "helperText": ""
  },
  "journaltitle": {
    "key": "journaltitle",
    "label": "Journal title",
    "helperText": ""
  },
  "key": {
    "key": "key",
    "label": "Key",
    "helperText": "Alphabetizing key"
  },
  "month": {
    "key": "month",
    "label": "Month",
    "helperText": ""
  },
  "note": {
    "key": "note",
    "label": "Note",
    "helperText": ""
  },
  "number": {
    "key": "number",
    "label": "Number",
    "helperText": ""
  },
  "organization": {
    "key": "organization",
    "label": "Organization",
    "helperText": ""
  },
  "pages": {
    "key": "pages",
    "label": "Pages",
    "helperText": "Page range"
  },
  "publisher": {
    "key": "publisher",
    "label": "Publisher",
    "helperText": ""
  },
  "school": {
    "key": "school",
    "label": "School",
    "helperText": ""
  },
  "series": {
    "key": "series",
    "label": "Series",
    "helperText": ""
  },
  "title": {
    "key": "title",
    "label": "Title",
    "helperText": ""
  },
  "type": {
    "key": "type",
    "label": "Type",
    "helperText": ""
  },
  "url": {
    "key": "url",
    "label": "URL",
    "helperText": ""
  },
  "volume": {
    "key": "volume",
    "label": "Volume",
    "helperText": ""
  },
  "year": {
    "key": "year",
    "label": "Year",
    "helperText": ""
  },
  "subtitle": {
    "key": "subtitle",
    "label": "Subtitle",
    "helperText": ""
  },
  "titleaddon": {
    "key": "titleaddon",
    "label": "Title addon",
    "helperText": "Any addition to the title not part of the original"
  },
  "language": {
    "key": "language",
    "label": "Language",
    "helperText": ""
  },
  "addendum": {
    "key": "addendum",
    "label": "Addendum",
    "helperText": "Any closing note added after the main reference details"
  },
  "pubstate": {
    "key": "pubstate",
    "label": "Publication state",
    "helperText": "The publication status, e.g. In press or Submitted"
  },
  "editora": {
    "key": "editora",
    "label": "Editor A",
    "helperText": "Separate multiple names with \"and\""
  },
  "editorb": {
    "key": "editorb",
    "label": "Editor B",
    "helperText": "Separate multiple names with \"and\""
  },
  "editorc": {
    "key": "editorc",
    "label": "Editor C",
    "helperText": "Separate multiple names with \"and\""
  },
  "translator": {
    "key": "translator",
    "label": "Translator",
    "helperText": "Separate multiple names with \"and\""
  },
  "annotator": {
    "key": "annotator",
    "label": "Annotator",
    "helperText": "Separate multiple names with \"and\""
  },
  "commentator": {
    "key": "commentator",
    "label": "Commentator",
    "helperText": "Separate multiple names with \"and\""
  },
  "introduction": {
    "key": "introduction",
    "label": "Introduction",
    "helperText": "Author of the introduction. Separate multiple names with \"and\""
  },
  "foreword": {
    "key": "foreword",
    "label": "Foreword",
    "helperText": "Author of the foreword. Separate multiple names with \"and\""
  },
  "afterword": {
    "key": "afterword",
    "label": "Afterword",
    "helperText": "Author of the afterword. Separate multiple names with \"and\""
  },
  "bookauthor": {
    "key": "bookauthor",
    "label": "Book author",
    "helperText": "Separate multiple names with \"and\""
  },
  "holder": {
    "key": "holder",
    "label": "Holder",
    "helperText": "The copyright holder, typically used for patents"
  },
  "maintitle": {
    "key": "maintitle",
    "label": "Main title",
    "helperText": "Main title of a multi-volume work"
  },
  "mainsubtitle": {
    "key": "mainsubtitle",
    "label": "Main subtitle",
    "helperText": ""
  },
  "maintitleaddon": {
    "key": "maintitleaddon",
    "label": "Main title addon",
    "helperText": "Any addition to the title not part of the original"
  },
  "booksubtitle": {
    "key": "booksubtitle",
    "label": "Book subtitle",
    "helperText": ""
  },
  "booktitleaddon": {
    "key": "booktitleaddon",
    "label": "Book title addon",
    "helperText": "Any addition to the title not part of the original"
  },
  "volumes": {
    "key": "volumes",
    "label": "Volumes",
    "helperText": ""
  },
  "part": {
    "key": "part",
    "label": "Part",
    "helperText": ""
  },
  "pagetotal": {
    "key": "pagetotal",
    "label": "Page total",
    "helperText": ""
  },
  "eid": {
    "key": "eid",
    "label": "EID",
    "helperText": "Electronic identifier (article ID)"
  },
  "journalsubtitle": {
    "key": "journalsubtitle",
    "label": "Journal subtitle",
    "helperText": ""
  },
  "journaltitleaddon": {
    "key": "journaltitleaddon",
    "label": "Journal title addon",
    "helperText": "Any addition to the title not part of the original"
  },
  "issuetitle": {
    "key": "issuetitle",
    "label": "Issue title",
    "helperText": ""
  },
  "issuesubtitle": {
    "key": "issuesubtitle",
    "label": "Issue subtitle",
    "helperText": ""
  },
  "issuetitleaddon": {
    "key": "issuetitleaddon",
    "label": "Issue title addon",
    "helperText": "Any addition to the title not part of the original"
  },
  "issue": {
    "key": "issue",
    "label": "Issue",
    "helperText": ""
  },
  "eventtitle": {
    "key": "eventtitle",
    "label": "Event title",
    "helperText": ""
  },
  "eventtitleaddon": {
    "key": "eventtitleaddon",
    "label": "Event title addon",
    "helperText": "Any addition to the title not part of the original"
  },
  "eventdate": {
    "key": "eventdate",
    "label": "Event date",
    "helperText": ""
  },
  "venue": {
    "key": "venue",
    "label": "Venue",
    "helperText": ""
  },
  "location": {
    "key": "location",
    "label": "Location",
    "helperText": ""
  },
  "version": {
    "key": "version",
    "label": "Version",
    "helperText": ""
  },
  "isbn": {
    "key": "isbn",
    "label": "ISBN",
    "helperText": "International Standard Book Number"
  },
  "issn": {
    "key": "issn",
    "label": "ISSN",
    "helperText": "International Standard Serial Number"
  },
  "isrn": {
    "key": "isrn",
    "label": "ISRN",
    "helperText": "The report identifier, equivalent to ISBN for technical reports"
  },
  "eprintclass": {
    "key": "eprintclass",
    "label": "Eprint class",
    "helperText": "The subject class for the preprint, e.g. cs.AI"
  },
  "eprinttype": {
    "key": "eprinttype",
    "label": "Eprint type",
    "helperText": "The archive name, e.g. arXiv"
  },
  "urldate": {
    "key": "urldate",
    "label": "URL date",
    "helperText": "The date you accessed the page"
  },
  "origlanguage": {
    "key": "origlanguage",
    "label": "Original language",
    "helperText": "The original language if this is a translation"
  }
}

export function getEntryTypeSchema(type: string): EntryTypeSchema {
  const found = ENTRY_TYPES[type]
  if (found) return found
  const misc = ENTRY_TYPES.misc
  return {
    key: type,
    label: type,
    fields: misc?.fields ?? [],
    requiredFields: misc?.requiredFields ?? [],
    optionalFields: misc?.optionalFields ?? [],
  }
}

export function getFieldsForEntryType(type: string): string[] {
  return (ENTRY_TYPES[type] ? getEntryTypeSchema(type).fields : ENTRY_TYPES.misc?.fields) || []
}

export function getEntryTypeKeys(): string[] {
  return Object.keys(ENTRY_TYPES)
}

export function getEntryTypeOptions(): Array<{ value: string; label: string }> {
  return Object.values(ENTRY_TYPES).map(t => ({ value: t.key, label: t.label }))
}

export function getFieldMeta(field: string): FieldMeta | undefined {
  return FIELDS[field]
}
