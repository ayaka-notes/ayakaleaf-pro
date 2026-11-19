// LanguageTool response builder + request resolution.
//
// Converts grammar-llm core output (suggestions/wordFixes) into the
// LanguageTool HTTP v2 "check" JSON shape so Overleaf — and any other client
// speaking the LanguageTool protocol — works unchanged.
//
// Key invariant (from Overleaf's LanguageTool module):
//   annotations.map(a => a.text ?? a.markup).join('') === editor source
// so match offsets must be offsets into the EDITOR SOURCE document.
//
// Strategy:
//   - Reconstruct the full document text (text + markup segments in order).
//   - Identify maximal plain-text runs (language: markup = "ignore this text").
//   - Run the grammar-llm core pipeline on each run (the LLM never sees LaTeX
//     markup, and no match can ever span it).
//   - Rebase suggestion offsets by the run's document offset — matches end up
//     in editor-source coordinates, as Overleaf expects.
//
// Response schema reference
//   (languagetool: org.languagetool.tools.RuleMatchesAsJsonSerializer):
//     top-level : { software, warnings, language, matches[], sentenceRanges }
//     match     : { message, shortMessage?, replacements[], offset, length,
//                   context, type, rule, ignoreForIncompleteSentence, contextForSureMatch }
//     replacement: { value, suffix?, type? }
//     rule      : { id, description, issueType, category, tags? }
//     category  : { id, name }
//
// Overleaf consumes: matches[].offset/.length, matches[].message,
// matches[].replacements[] (first 5 values), matches[].rule.category.id
// (filters id === 'TYPOS' while Hunspell is active). We use
// category.id = 'GRAMMAR' so our results survive that filter.

import type { Suggestion, WordFix } from '../core/types.js';

export interface LtReplacement {
  value: string;
}

export interface LtRule {
  id: string;
  description: string;
  issueType: string;
  category: { id: string; name: string };
  tags?: string[];
}

export interface LtMatch {
  message: string;
  shortMessage?: string;
  replacements: LtReplacement[];
  offset: number;
  length: number;
  context: { text: string; offset: number; length: number };
  type: { typeName: string };
  rule: LtRule;
  ignoreForIncompleteSentence: boolean;
  contextForSureMatch: number;
}

export interface LtLanguage {
  name: string;
  code: string;
  longCode: string;
}

export interface LtCheckResponse {
  software: {
    name: string;
    version: string;
    buildDate: string;
    apiVersion: number;
    premium: boolean;
    status: string;
  };
  warnings: { incompleteResults: boolean; incompleteResultsReason?: string };
  language: {
    name: string;
    code: string;
    detectedLanguage: { name: string; code: string; confidence: number; source: string };
  };
  matches: LtMatch[];
  sentenceRanges: Array<[number, number]>;
}

/** Static rule object reported on every match. */
const RULE: LtRule = {
  id: 'GRAMMAR_LLM',
  description: 'Grammar, spelling, or style issue detected by grammar-llm (GRMR-V3-G4B)',
  issueType: 'Grammar',
  category: { id: 'GRAMMAR', name: 'Grammar' },
  tags: ['LLM', 'GRMR-V3-G4B'],
};

/** Languages we advertise (GRMR-V3-G4B is English-only). */
const LANGUAGES: LtLanguage[] = [
  { name: 'English (US)', code: 'en-US', longCode: 'en-US' },
  { name: 'English (UK)', code: 'en-GB', longCode: 'en-GB' },
  { name: 'English (Australia)', code: 'en-AU', longCode: 'en-AU' },
  { name: 'English (Canada)', code: 'en-CA', longCode: 'en-CA' },
  { name: 'English (Ireland)', code: 'en-IE', longCode: 'en-IE' },
  { name: 'English (New Zealand)', code: 'en-NZ', longCode: 'en-NZ' },
  { name: 'English (India)', code: 'en-IN', longCode: 'en-IN' },
  { name: 'English (South Africa)', code: 'en-ZA', longCode: 'en-ZA' },
  { name: 'English', code: 'en', longCode: 'en' },
];

export function getLanguages(): LtLanguage[] {
  return LANGUAGES;
}

export function normalizeLanguage(code: string | null | undefined): LtLanguage | null {
  if (code === null || code === undefined || String(code).trim() === '' || String(code).trim().toLowerCase() === 'auto') {
    return LANGUAGES[0]; // default: English (US)
  }
  const c = String(code).trim().toLowerCase();
  return LANGUAGES.find((l) => l.code.toLowerCase() === c) ?? null;
}

/** A plain-text segment with its absolute offset into the full document. */
export interface TextRun {
  text: string;
  offset: number;
}

export interface ResolvedCheckInput {
  /** Full document text (markup included) — offsets/limits are against this. */
  text: string;
  /** Maximal checkable runs (plain text), offsets absolute into `text`. */
  runs: TextRun[];
}

export type CheckInput = ResolvedCheckInput | { error: string };

/**
 * Resolve the text to check from a request body (LanguageTool `text`/`data`
 * parameters; `data` may be a JSON object {text, annotation:[{text|markup}]}
 * — Overleaf sends annotation when it has a Lezer syntax tree).
 */
export function resolveCheckInput(body: Record<string, unknown>): CheckInput {
  const rawText = body['text'];
  const rawData = body['data'];

  if (rawText === undefined && rawData === undefined) {
    return { error: "Missing 'text' or 'data' parameter" };
  }

  // 1) plain `text` parameter
  if (typeof rawText === 'string') {
    return { text: rawText, runs: [{ text: rawText, offset: 0 }] };
  }

  // 2) `data` parameter (string JSON or object)
  let data: unknown = rawData;
  if (typeof rawData === 'string') {
    try {
      data = JSON.parse(rawData);
    } catch {
      // Not JSON — treat the raw string as plain text.
      return { text: rawData, runs: [{ text: rawData, offset: 0 }] };
    }
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d['text'] === 'string' && d['annotation'] === undefined) {
      return { text: d['text'], runs: [{ text: d['text'], offset: 0 }] };
    }
    if (Array.isArray(d['annotation'])) {
      // Reconstruct the full document and collect maximal plain-text runs
      // with offsets absolute into it (markup segments keep alignment).
      let text = '';
      let pendingStart = -1;
      const runs: TextRun[] = [];
      const flush = () => {
        if (pendingStart >= 0) {
          runs.push({ text: text.slice(pendingStart), offset: pendingStart });
          pendingStart = -1;
        }
      };
      for (const seg of d['annotation']) {
        if (!seg || typeof seg !== 'object') continue;
        const s = seg as Record<string, unknown>;
        if (typeof s['text'] === 'string') {
          if (pendingStart < 0) pendingStart = text.length;
          text += s['text'];
        } else if (typeof s['markup'] === 'string') {
          flush();
          text += s['markup'];
        }
      }
      flush();
      return { text, runs: runs.filter((r) => r.text.trim().length > 0) };
    }
  }

  return { error: "Missing 'text' or 'data' parameter" };
}

function buildContext(fullText: string, offset: number, length: number, radius = 25): { text: string; offset: number; length: number } {
  const from = Math.max(0, offset - radius);
  const to = Math.min(fullText.length, offset + length + radius);
  return {
    text: fullText.slice(from, to),
    offset: offset - from,
    length: Math.max(0, length),
  };
}

interface BaseMatchOpts {
  message: string;
  shortMessage?: string;
  replacement: string;
}

function makeMatch(fullText: string, offset: number, length: number, opts: BaseMatchOpts): LtMatch {
  return {
    message: opts.message,
    ...(opts.shortMessage !== undefined ? { shortMessage: opts.shortMessage } : {}),
    replacements: [{ value: opts.replacement }],
    offset,
    length,
    context: buildContext(fullText, offset, length),
    type: { typeName: 'grammar' },
    rule: RULE,
    ignoreForIncompleteSentence: false,
    contextForSureMatch: -1,
  };
}

/**
 * Anchor a zero-width (pure insertion) fix to the nearest non-whitespace
 * token, expressed as a LanguageTool replacement match:
 *   - insertion before token T (at or before T): match T, replace with added+T
 *   - insertion at run end: match the last token, replace with T+added
 */
function anchorInsertion(
  fullText: string,
  run: TextRun,
  pos: number,
  addedText: string,
): LtMatch | null {
  const added = addedText.trim();
  if (!added) return null;
  const base = run.offset;
  const isPunct = /^\s*[.,!?;:'"()\[\]{}]+\s*$/.test(added);

  // Next non-whitespace token at/after pos (within the run).
  const rest = run.text.slice(pos);
  const mNext = rest.match(/^\s*(\S+)/);
  if (mNext) {
    const wsLen = mNext[0].length - mNext[1].length;
    const tok = mNext[1];
    const tokStart = pos + wsLen;
    const tokEnd = tokStart + tok.length;
    if (tokEnd <= run.text.length) {
      const gap = run.text.slice(pos, tokStart);
      // Punctuation attaches to the preceding word (no leading gap); a word
      // keeps the preceding gap and gets exactly one space before the token.
      const replacement = (isPunct ? added + (gap ? ' ' : '') + tok : gap + added + ' ' + tok) as string;
      const collapsed = replacement.replace(/\s{2,}/g, ' ');
      return makeMatch(fullText, base + pos, tokEnd - pos, {
        message: isPunct ? `Add '${added}' after the previous word` : `Add '${added}' before '${tok}'`,
        shortMessage: `add "${added}"`,
        replacement: collapsed,
      });
    }
  }

  // No token after the insertion point → anchor on the last non-whitespace
  // token of the run (insertion at the run's end).
  const before = run.text.slice(0, pos);
  const mLast = before.match(/(\S+)\s*$/);
  if (mLast && mLast.index !== undefined) {
    const tok = mLast[1];
    const tokStart = mLast.index;
    const replacement = (tok + (isPunct ? added : ` ${added}`)).replace(/\s{2,}/g, ' ');
    return makeMatch(fullText, base + tokStart, tok.length, {
      message: `Add '${added}' at the end of the sentence`,
      shortMessage: `add "${added}"`,
      replacement,
    });
  }
  return null;
}

/**
 * Map one core suggestion (offsets are absolute into the original full input
 * text passed to correctText) to LanguageTool matches, rebased onto the
 * editor document via `run`.
 */
export function suggestionToMatches(fullText: string, run: TextRun, suggestion: Suggestion): LtMatch[] {
  const out: LtMatch[] = [];
  const fixes = suggestion.wordFixes ?? [];
  let usedWordFixes = false;

  for (const fix of fixes) {
    const m = wordFixToMatch(fullText, run, fix);
    if (m) {
      out.push(m);
      usedWordFixes = true;
    }
  }

  // Full rewrite with no word-level fixes: one sentence-level match over the
  // changed middle span, replacing it with the corrected middle.
  if (!usedWordFixes) {
    const span = sentenceChangeSpan(run, suggestion);
    if (span) {
      out.push(
        makeMatch(fullText, span.offset, span.length, {
          message: 'Suggested grammar/style correction (rewrite by grammar-llm)',
          shortMessage: 'rewrite',
          replacement: span.replacement,
        }),
      );
    }
  }
  return out;
}

/**
 * GRMR models sometimes emit the corrected word wrapped in quotes:
 *   'goed' -> '"good"',  'cat' -> '"Cat"'.
 * The desktop app shows that verbatim in the review UI, but a LanguageTool-style
 * client applies replacements[] verbatim, which would inject literal quote
 * characters into the document (bad in LaTeX). The adapter layer therefore
 * unwraps one pair of matching surrounding quotes from a word fix.
 */
function unwrapQuotedCorrection(corrected: string): string {
  if (!corrected || corrected.length < 3) return corrected;
  const pairs: Array<[string, string]> = [
    ['\u201C', '\u201D'], // “ ”
    ['"', '"'], // “ ”
    ['\u2018', '\u2019'], // ‘ ’
    ["'", "'"], // ' '
  ];
  for (const [open, close] of pairs) {
    if (corrected.startsWith(open) && corrected.endsWith(close) && corrected.length >= open.length + close.length + 1) {
      const inner = corrected.slice(open.length, corrected.length - close.length);
      if (inner.trim().length > 0 && !inner.includes('\n') && (inner.match(/\s/g) ?? []).length <= 1) {
        return inner;
      }
    }
  }
  return corrected;
}

function wordFixToMatch(fullText: string, run: TextRun, fix: WordFix): LtMatch | null {
  // WordFix offsets are absolute in the text passed to correctText (the run's
  // text, 0-based) — rebase via run.offset.
  const relStart = fix.start - 0; // fix.start is already run-relative
  const relEnd = fix.end;
  if (relStart < 0 || relStart > run.text.length) return null;
  const base = run.offset;

  if (relEnd > relStart) {
    const length = Math.min(relEnd - relStart, run.text.length - relStart);
    if (length <= 0) return null;
    const replacement = unwrapQuotedCorrection(fix.corrected ?? '');
    const message = replacement === '' ? `Remove '${fix.original}'` : `Shouldn't this be '${replacement}'?`;
    return makeMatch(fullText, base + relStart, length, {
      message,
      shortMessage: replacement === '' ? undefined : replacement,
      replacement,
    });
  }

  // Zero width → pure insertion; anchor on a neighbouring token.
  return anchorInsertion(fullText, run, relEnd, fix.corrected ?? '');
}

interface SpanResult {
  offset: number;
  length: number;
  replacement: string;
}

/** Changed middle span of a sentence-level rewrite (run-relative). */
function sentenceChangeSpan(run: TextRun, s: Suggestion): SpanResult | null {
  const original = s.original;
  const corrected = s.corrected ?? '';
  if (!original || !corrected || original === corrected) return null;
  if (s.start_index < 0 || s.end_index <= s.start_index) return null;

  const a = original;
  const b = corrected;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let suffix = 0;
  while (suffix < a.length - p && suffix < b.length - p && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

  const relOffset = s.start_index + p;
  const relLength = a.length - p - suffix;
  if (relOffset < 0 || relLength <= 0 || relOffset >= run.text.length) return null;
  const length = Math.min(relLength, run.text.length - relOffset);
  if (length <= 0) return null;
  return {
    offset: run.offset + relOffset,
    length,
    replacement: b.slice(p, b.length - suffix),
  };
}

/**
 * Build the full LanguageTool v2 "check" JSON body.
 */
export function buildCheckResponse(opts: {
  fullText: string;
  matches: LtMatch[];
  sentenceRanges: Array<[number, number]>;
  languageCode?: string;
  incomplete?: string;
  reportedVersion?: string;
}): LtCheckResponse {
  const lang = normalizeLanguage(opts.languageCode) ?? LANGUAGES[0];
  const matches = [...opts.matches].sort((x, y) => x.offset - y.offset || x.length - y.length);

  return {
    software: {
      name: 'LanguageTool',
      version: opts.reportedVersion ?? '6.8',
      buildDate: new Date().toISOString().slice(0, 10),
      apiVersion: 1,
      premium: false,
      status: '',
    },
    warnings: {
      incompleteResults: Boolean(opts.incomplete),
      ...(opts.incomplete ? { incompleteResultsReason: opts.incomplete } : {}),
    },
    language: {
      name: lang.name,
      code: lang.code,
      detectedLanguage: { name: lang.name, code: lang.code, confidence: 1, source: 'given' },
    },
    matches,
    sentenceRanges: opts.sentenceRanges ?? [],
  };
}
