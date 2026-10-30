const TEMPLATE_TAG_RE = /<\|.*?\|>/g;
const QUOTE_PERIOD_RE = /([.!?])(["'])\s*\./g;
const QUOTE_DUP_RE = /([.!?])(["'])\s*\1/g;

// Mojibake: the UTF-8 bytes of smart quotes (e.g. U+201C = E2 80 9C) can arrive
// as Latin-1/CP1252 characters (\u00e2\u20ac\u0153 = "â€œ", or \u00e2\u0080\u009c
// when the C1 control bytes survive). Models fine-tuned on scraped data often
// reproduce these instead of proper quotes. Replace longer patterns first.
const MOJIBAKE_PATTERNS: Array<[RegExp, string]> = [
  [/\u00e2\u20ac\u0153/g, '\u201C'], // “
  [/\u00e2\u0080\u009c/g, '\u201C'], // “ (raw control bytes)
  [/\u00e2\u20ac\u009d/g, '\u201D'], // ”
  [/\u00e2\u0080\u009d/g, '\u201D'], // ” (raw control bytes)
  [/\u00e2\u20ac\u02dc/g, '\u2018'], // ‘
  [/\u00e2\u0080\u0098/g, '\u2018'], // ‘ (raw control bytes)
  [/\u00e2\u20ac\u2122/g, '\u2019'], // ’
  [/\u00e2\u0080\u0099/g, '\u2019'], // ’ (raw control bytes)
  [/\u00e2\u20ac\u00a6/g, '\u2026'], // …
  [/\u00e2\u0080\u00a6/g, '\u2026'], // … (raw control bytes)
];

/** Normalize mojibake smart quotes back to proper Unicode characters. */
export function fixMojibakeQuotes(s: string): string {
  let result = s;
  for (const [pattern, replacement] of MOJIBAKE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

const INSTRUCTION_PREFIXES = [
  'correct the grammar and spelling of this sentence:',
  'here is the corrected sentence:',
  'corrected sentence:',
  'the corrected version is:',
  'grammar correction:',
  'corrected:',
];

export function cleanCorrectedText(corrected: string, original: string): string {
  if (!corrected) return original;

  let result = fixMojibakeQuotes(corrected).replace(TEMPLATE_TAG_RE, '').trim();

  for (const prefix of INSTRUCTION_PREFIXES) {
    if (result.toLowerCase().startsWith(prefix)) {
      result = result.slice(prefix.length).trim();
      result = result.replace(/^[:]\s*/, '');
    }
  }

  const words = result.split(/\s+/);
  if (words.length > 10) {
    for (let i = 0; i < words.length - 5; i++) {
      const segment = words.slice(i, i + 5).join(' ');
      if (words.slice(i + 5).join(' ').includes(segment)) {
        result = words.slice(0, i + 5).join(' ');
        break;
      }
    }
  }

  if (original && /^[A-Z]/.test(original) && result && /^[a-z]/.test(result)) {
    result = result[0].toUpperCase() + result.slice(1);
  }

  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(QUOTE_PERIOD_RE, '$1$2');
    result = result.replace(QUOTE_DUP_RE, '$1$2');
    if (result === before) break;
  }

  if (original && /[.!?]$/.test(original) && result && !/[.!?]$/.test(result)) {
    result += original[original.length - 1];
  }

  return result.trim();
}

export function isOnlyQuoteChange(original: string, corrected: string): boolean {
  if (original === corrected) return false;
  const normalize = (s: string): string => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  if (normalize(original) === normalize(corrected)) return true;
  if (normalize(original.trim()) === normalize(corrected.trim())) return true;
  return false;
}
