// Unit tests for the LanguageTool mapper & request resolution.
// Runs against the esbuild bundle (dist/languagetool.mjs) with the vendored
// core — no LLM, no network.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCheckResponse,
  getLanguages,
  normalizeLanguage,
  resolveCheckInput,
  suggestionToMatches,
} from '../dist/languagetool.mjs';

const RUN = { text: 'He said teh thing.', offset: 0 };

function suggestionWith(fixes, original = 'He said teh thing.', corrected = 'He said the thing.') {
  return {
    original,
    corrected,
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: original.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: fixes,
  };
}

test('replacement word fix → LT match with absolute offset', () => {
  const matches = suggestionToMatches(RUN.text, RUN, suggestionWith([{ original: 'teh', corrected: 'the', start: 8, end: 11 }]));
  assert.equal(matches.length, 1);
  const m = matches[0];
  assert.equal(m.offset, 8);
  assert.equal(m.length, 3);
  assert.deepEqual(m.replacements, [{ value: 'the' }]);
  assert.match(m.message, /'the'/);
  assert.equal(m.rule.category.id, 'GRAMMAR'); // must not be 'TYPOS' (Overleaf filter)
  assert.equal(m.context.text.slice(m.context.offset, m.context.offset + m.length), 'teh');
});

test('deletion word fix → empty replacement', () => {
  const text = 'He said very very thing.';
  const run = { text, offset: 0 };
  const matches = suggestionToMatches(text, run, {
    original: text,
    corrected: 'He said very thing.',
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: text.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: [{ original: 'very', corrected: '', start: 13, end: 17 }],
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].offset, 13);
  assert.equal(matches[0].length, 4);
  assert.deepEqual(matches[0].replacements, [{ value: '' }]);
  assert.match(matches[0].message, /Remove/);
});

test('punctuation insertion after a word attaches to the previous word (core ground truth)', () => {
  // core emit for 'slow and happy' -> 'slowly, and happy':
  //   slow->slowly [0,4)  +  pure insertion ',' at pos 4
  const text = 'slow and happy';
  const run = { text, offset: 0 };
  const matches = suggestionToMatches(text, run, {
    original: text,
    corrected: 'slowly, and happy',
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: text.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: [{ original: 'slow', corrected: 'slowly', start: 0, end: 4 }, { original: '', corrected: ',', start: 4, end: 4 }],
  });
  const m = matches[1];
  assert.equal(m.offset, 4);
  assert.equal(m.length, 4); // covers ' and' (gap + token)
  assert.equal(m.replacements[0].value, ', and');
  // Apply both matches (reverse offset order) to the original doc.
  let doc = text;
  for (const m2 of [...matches].sort((a, b) => b.offset - a.offset)) {
    doc = doc.slice(0, m2.offset) + m2.replacements[0].value + doc.slice(m2.offset + m2.length);
  }
  assert.equal(doc, 'slowly, and happy');
});

test('word insertion before a token keeps spacing (core ground truth)', () => {
  // core emit for 'quick and happy' -> 'quick and very happy':
  //   pure insertion 'very ' at pos 10 (before 'happy')
  const text = 'quick and happy';
  const run = { text, offset: 0 };
  const matches = suggestionToMatches(text, run, {
    original: text,
    corrected: 'quick and very happy',
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: text.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: [{ original: '', corrected: 'very ', start: 10, end: 10 }],
  });
  const m = matches[0];
  assert.equal(m.offset, 10);
  assert.equal(m.length, 5); // token 'happy'
  assert.equal(m.replacements[0].value, 'very happy');
  const result = text.slice(0, m.offset) + m.replacements[0].value + text.slice(m.offset + m.length);
  assert.equal(result, 'quick and very happy');
});

test('punctuation insertion right before a token (no gap)', () => {
  const text = 'He ate andbutter fast';
  const run = { text, offset: 0 };
  const matches = suggestionToMatches(text, run, {
    original: text,
    corrected: 'He ate and,butter fast',
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: text.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: [{ original: '', corrected: ',', start: 10, end: 10 }],
  });
  const m = matches[0];
  assert.equal(m.offset, 10);
  assert.equal(m.length, 6); // token 'butter'
  assert.equal(m.replacements[0].value, ',butter');
  const result = text.slice(0, m.offset) + m.replacements[0].value + text.slice(m.offset + m.length);
  assert.equal(result, 'He ate and,butter fast');
});

test('insertion at run end anchors on last token', () => {
  const text = 'He ran quick';
  const run = { text, offset: 0 };
  const matches = suggestionToMatches(text, run, {
    original: text,
    corrected: 'He ran quick.',
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: text.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: [{ original: '', corrected: '.', start: 12, end: 12 }],
  });
  const m = matches[0];
  const result = text.slice(0, m.offset) + m.replacements[0].value + text.slice(m.offset + m.length);
  assert.equal(result, 'He ran quick.');
});

test('model quote artifacts are unwrapped from replacements', () => {
  // GRMR sometimes wraps the corrected word in quotes: 'goed' -> '"good"'
  const text = 'The cat is goed.';
  const run = { text, offset: 0 };
  for (const corrected of ['"good"', '\u201Cgood\u201D', "'good'"]) {
    const matches = suggestionToMatches(text, run, {
      original: text,
      corrected: 'The cat is good.',
      sentence: 'Sentence 1',
      start_index: 0,
      end_index: text.length,
      original_highlighted: '',
      corrected_highlighted: '',
      wordFixes: [{ original: 'goed', corrected, start: 11, end: 15 }],
    });
    assert.equal(matches.length, 1, 'one match for ' + corrected);
    assert.equal(matches[0].replacements[0].value, 'good');
  }
  // …same for a different word — a grammar model quoting its replacement is a
  // display artifact, not a request to add quotes to the document
  const m2 = suggestionToMatches(text, run, {
    original: text,
    corrected: 'The cat is wonderful.',
    sentence: 'Sentence 1',
    start_index: 0,
    end_index: text.length,
    original_highlighted: '',
    corrected_highlighted: '',
    wordFixes: [{ original: 'goed', corrected: '"wonderful"', start: 11, end: 15 }],
  });
  assert.equal(m2[0].replacements[0].value, 'wonderful');
});

test('sentence-level rewrite (no word fixes) → partial-span replacement, offset-rebased', () => {
  const text = 'The committee met every day';
  const run = { text, offset: 100 };
  const s = suggestionWith([], 'The committee met every day', 'The committee has met daily');
  const matches = suggestionToMatches(text, run, s);
  assert.equal(matches.length, 1);
  const m = matches[0];
  const result = text.slice(0, m.offset - 100) + m.replacements[0].value + text.slice(m.offset - 100 + m.length);
  assert.equal(result, 'The committee has met daily');
  assert.ok(m.offset >= 100); // rebased onto the document
});

test('matches outside the run text are dropped', () => {
  const run = { text: 'short', offset: 0 };
  const matches = suggestionToMatches('short', run, suggestionWith([{ original: 'x', corrected: 'y', start: 99, end: 100 }]));
  assert.equal(matches.length, 0);
});

test('resolveCheckInput: plain text param', () => {
  const r = resolveCheckInput({ text: 'Hello world' });
  assert.ok(!('error' in r));
  assert.equal(r.text, 'Hello world');
  assert.deepEqual(r.runs, [{ text: 'Hello world', offset: 0 }]);
});

test('resolveCheckInput: annotation (Overleaf LaTeX payload) keeps offset alignment', () => {
  const annotation = [
    { text: 'The dog ' },
    { markup: '{\\textbf{runs}} ' },
    { text: 'fast.' },
  ];
  const r = resolveCheckInput({ data: JSON.stringify({ annotation }) });
  assert.ok(!('error' in r));
  assert.equal(r.text, 'The dog {\\textbf{runs}} fast.');
  assert.deepEqual(r.runs, [
    { text: 'The dog ', offset: 0 },
    { text: 'fast.', offset: 24 },
  ]);
});

test('resolveCheckInput: { text } data object', () => {
  const r = resolveCheckInput({ data: { text: 'abc' } });
  assert.equal(r.text, 'abc');
  assert.deepEqual(r.runs, [{ text: 'abc', offset: 0 }]);
});

test('resolveCheckInput: missing text and data → error', () => {
  const r = resolveCheckInput({});
  assert.ok('error' in r);
  assert.match(r.error, /Missing/);
});

test('resolveCheckInput: non-JSON string data is treated as text', () => {
  const r = resolveCheckInput({ data: 'plain string data' });
  assert.equal(r.text, 'plain string data');
});

test('normalizeLanguage: auto + en variants accepted, de rejected', () => {
  assert.equal(normalizeLanguage(null).code, 'en-US');
  assert.equal(normalizeLanguage('auto').code, 'en-US');
  assert.equal(normalizeLanguage('en-GB').code, 'en-GB');
  assert.equal(normalizeLanguage('EN').code, 'en');
  assert.equal(normalizeLanguage('de'), null);
});

test('getLanguages: LanguageTool list shape (name/code/longCode)', () => {
  const langs = getLanguages();
  assert.ok(Array.isArray(langs));
  for (const l of langs) {
    assert.ok(typeof l.name === 'string');
    assert.ok(typeof l.code === 'string');
    assert.ok(typeof l.longCode === 'string');
  }
  assert.ok(langs.some((l) => l.code === 'en-US'));
});

test('buildCheckResponse: LT envelope shape + sorted matches + warnings', () => {
  const body = buildCheckResponse({
    fullText: 'He said teh thing.',
    matches: [
      {
        message: 'm2',
        replacements: [{ value: 'b' }],
        offset: 10,
        length: 1,
        context: { text: 'x', offset: 0, length: 1 },
        type: { typeName: 'grammar' },
        rule: { id: 'GRAMMAR_LLM', description: 'd', issueType: 'Grammar', category: { id: 'GRAMMAR', name: 'Grammar' } },
        ignoreForIncompleteSentence: false,
        contextForSureMatch: -1,
      },
      {
        message: 'm1',
        replacements: [{ value: 'a' }],
        offset: 3,
        length: 1,
        context: { text: 'x', offset: 0, length: 1 },
        type: { typeName: 'grammar' },
        rule: { id: 'GRAMMAR_LLM', description: 'd', issueType: 'Grammar', category: { id: 'GRAMMAR', name: 'Grammar' } },
        ignoreForIncompleteSentence: false,
        contextForSureMatch: -1,
      },
    ],
    sentenceRanges: [
      [0, 18],
    ],
    languageCode: 'en-GB',
    incomplete: 'stopped early',
  });
  assert.equal(body.software.name, 'LanguageTool');
  assert.equal(body.software.apiVersion, 1);
  assert.equal(body.software.premium, false);
  assert.equal(body.language.code, 'en-GB');
  assert.equal(body.language.detectedLanguage.source, 'given');
  assert.deepEqual(body.matches.map((m) => m.offset), [3, 10]);
  assert.equal(body.warnings.incompleteResults, true);
  assert.equal(body.warnings.incompleteResultsReason, 'stopped early');
  assert.deepEqual(body.sentenceRanges, [[0, 18]]);
});
