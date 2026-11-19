import type { Suggestion } from './types.js';

export function findAllOccurrences(haystack: string, needle: string): Array<[number, number]> {
  if (!needle || !haystack) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  const matches: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(haystack)) !== null) {
    matches.push([match.index, match.index + needle.length]);
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return matches;
}

function nearestOccurrence(occurrences: Array<[number, number]>, approxStart: number): [number, number] {
  return occurrences.reduce((best, occ) =>
    Math.abs(occ[0] - approxStart) < Math.abs(best[0] - approxStart) ? occ : best,
  );
}

export function applySuggestion(text: string, suggestionIndex: number, suggestions: Suggestion[]): string {
  if (suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
    throw new RangeError('Invalid suggestion index');
  }
  const suggestion = suggestions[suggestionIndex];
  const { start_index: start, end_index: end } = suggestion;

  if (start >= 0 && start <= end && end <= text.length && text.slice(start, end) === suggestion.original) {
    return text.slice(0, start) + suggestion.corrected + text.slice(end);
  }

  const occurrences = findAllOccurrences(text, suggestion.original);
  if (occurrences.length > 0) {
    const [tStart, tEnd] = nearestOccurrence(occurrences, start);
    return text.slice(0, tStart) + suggestion.corrected + text.slice(tEnd);
  }

  return text;
}

export function applySuggestionsBulk(text: string, suggestions: Suggestion[]): string {
  if (suggestions.length === 0) return text;

  const sorted = suggestions
    .filter((s) => s.start_index >= 0 && s.end_index >= 0 && s.start_index <= s.end_index)
    .sort((a, b) => b.start_index - a.start_index);

  const appliedIntervals: Array<[number, number]> = [];
  let result = text;

  for (const s of sorted) {
    const { start_index: start, end_index: end } = s;
    let candidate: [number, number] | null = null;

    if (end <= result.length && result.slice(start, end) === s.original) {
      candidate = [start, end];
    } else {
      const occurrences = findAllOccurrences(result, s.original);
      if (occurrences.length > 0) {
        candidate = nearestOccurrence(occurrences, start);
      }
    }

    if (!candidate) continue;

    const [cStart, cEnd] = candidate;
    const overlaps = appliedIntervals.some(([aStart, aEnd]) => !(cEnd <= aStart || cStart >= aEnd));
    if (overlaps) continue;

    result = result.slice(0, cStart) + s.corrected + result.slice(cEnd);
    appliedIntervals.push([cStart, cEnd]);
  }

  return result;
}
