import type { SentenceData } from './types.js';

const ABBREVIATIONS = new Set([
  'etc', 'eg', 'e.g', 'ie', 'i.e', 'vs', 'viz', 'cf', 'ca', 'approx',
  'no', 'vol', 'fig', 'p', 'pp', 'ch', 'sec', 'ex', 'al', 'et', 'seq',
  'etc.', 'e.g.', 'i.e.', 'vs.', 'viz.', 'cf.', 'ca.', 'approx.',
  'no.', 'vol.', 'fig.', 'p.', 'pp.', 'ch.', 'sec.', 'ex.', 'et al.', 'seq.',
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'sr', 'jr', 'st',
]);

// Python: (?<=[.!?])(?!\w)(?<!\d\.\d)(?<!\s[A-Za-z]\.)\s+(?=[A-Z"'])|(?<=[.!?])\s*$
// (re.VERBOSE + re.IGNORECASE; \w is ASCII in JS — acceptable for English text)
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])(?!\w)(?<!\d\.\d)(?<!\s[A-Za-z]\.)\s+(?=[A-Z"'])|(?<=[.!?])\s*$/gi;

// A missing space after terminal punctuation — "…on its functionality.The team
// were…". The original pattern needs \s+ after the punctuation, so such a run
// was swallowed into one sentence. This boundary is zero-width, so it is found
// separately, and only when:
//   * the punctuated word has at least two letters — keeps single-letter
//     initials glued ("U.S.Today") and decimals out ("3.5.Next"); abbreviations
//     such as "etc.They" are rejected later by ABBREVIATIONS; and
//   * the next word starts upper-case followed by a lower-case letter — keeps
//     "README.TXT" glued and skips "happy.enough".
const MISSING_SPACE_BOUNDARY_RE = /(?<=[A-Za-z]{2}[.!?])(?=[A-Z][a-z])/g;

interface BoundaryMatch {
  index: number; // position immediately after the terminal punctuation
  length: number; // whitespace separating the two sentences (0 when missing)
}

function findBoundaryMatches(text: string): BoundaryMatch[] {
  const matches: BoundaryMatch[] = [];
  for (const pattern of [SENTENCE_BOUNDARY_RE, MISSING_SPACE_BOUNDARY_RE]) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      matches.push({ index: match.index, length: match[0].length });
      // JS exec() loops forever on zero-width matches; Python's finditer()
      // auto-advances. Guard like findAllOccurrences does.
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  matches.sort((a, b) => a.index - b.index || b.length - a.length);
  // The two patterns are mutually exclusive (one needs a non-word character
  // right after the punctuation, the other an upper-case letter), but never
  // emit the same split twice.
  return matches.filter((m, i) => i === 0 || m.index !== matches[i - 1].index);
}

export function splitIntoSentences(text: string): SentenceData[] {
  const sentences: SentenceData[] = [];
  if (!text.trim()) return sentences;

  let lastEnd = 0;
  const potentialSplits = findBoundaryMatches(text);

  for (const { index: splitPos, length: gapLength } of potentialSplits) {
    const sentenceText = text.slice(lastEnd, splitPos).trim();
    if (!sentenceText) {
      lastEnd = splitPos + gapLength;
      continue;
    }

    let isTrueBoundary = true;

    const prevWords = sentenceText.toLowerCase().split(/\s+/);
    if (prevWords.length > 0) {
      const lastWord = prevWords[prevWords.length - 1].replace(/^[.,!?;:"']+|[.,!?;:"']+$/g, '');
      if (ABBREVIATIONS.has(lastWord)) {
        isTrueBoundary = false;
      } else if (/\d\.\d/.test(sentenceText.slice(-10))) {
        // Python quirk replicated: the single-letter-initial check was dead
        // code in main.py (misspelled variable), so initials ARE split here.
        isTrueBoundary = false;
      }
    }

    // Only meaningful for whitespace boundaries: it inspects the character
    // after the gap's first character to reject a lower-case continuation.
    // A space-less boundary is already constrained to an upper-case start.
    if (gapLength > 0 && splitPos + 2 < text.length) {
      const nextChars = text.slice(splitPos + 1, splitPos + 3);
      // Python: (next_chars and next_chars[0].islower()) or next_chars[0].isdigit()
      if (/[a-z\d]/.test(nextChars[0])) {
        isTrueBoundary = false;
      }
    }

    if (!isTrueBoundary) continue;

    let startNoWs = lastEnd;
    while (startNoWs < splitPos && /\s/.test(text[startNoWs])) startNoWs++;

    let spanEnd = splitPos;
    while (spanEnd < text.length && /\s/.test(text[spanEnd])) spanEnd++;
    // Nothing was consumed: only mark a one-character span when the boundary
    // sits at the very end of the text. Mid-text space-less boundaries must keep
    // spanEnd === end so reconstructTextFromSentences re-inserts the space.
    if (spanEnd === splitPos && splitPos >= text.length) spanEnd = splitPos + 1;

    sentences.push({ text: sentenceText, start: startNoWs, end: splitPos, spanEnd, gapBeforeStart: lastEnd });
    lastEnd = spanEnd;
  }

  if (lastEnd < text.length) {
    const remaining = text.slice(lastEnd).trim();
    if (remaining) {
      let startNoWs = lastEnd;
      while (startNoWs < text.length && /\s/.test(text[startNoWs])) startNoWs++;
      sentences.push({ text: remaining, start: startNoWs, end: text.length, spanEnd: text.length, gapBeforeStart: lastEnd });
    }
  }

  if (sentences.length === 0) {
    const content = text.trim();
    if (content) {
      let startNoWs = 0;
      while (startNoWs < text.length && /\s/.test(text[startNoWs])) startNoWs++;
      sentences.push({ text: content, start: startNoWs, end: text.length, spanEnd: text.length, gapBeforeStart: 0 });
    }
  }

  return sentences;
}
