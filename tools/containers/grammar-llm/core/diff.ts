import { diffArrays } from 'diff';
import type { WordFix } from './types.js';

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const char of text) {
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
    } else if ('.,!?;:"()[]{}\u201C\u201D'.includes(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// Curly quotes compare equal to their straight counterparts so that
// quote-style changes alone never trigger word highlighting.
function normalizeToken(token: string): string {
  return token
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

export function highlightWordDifferences(
  original: string,
  corrected: string,
): {
  originalHighlighted: string;
  correctedHighlighted: string;
  /** Corrected text with the original's quote characters restored. */
  preservedCorrected: string;
} {
  const originalTokens = tokenize(original);
  const correctedTokens = tokenize(corrected);
  const parts = diffArrays(originalTokens.map(normalizeToken), correctedTokens.map(normalizeToken));

  let originalHighlighted = '';
  let correctedHighlighted = '';
  let preservedCorrected = '';
  let originalIndex = 0;
  let correctedIndex = 0;

  for (const part of parts) {
    const value = Array.isArray(part.value) ? part.value : [part.value];
    const length = value.length;

    if (part.added) {
      for (let k = 0; k < length; k++) {
        const token = correctedTokens[correctedIndex + k];
        correctedHighlighted += token.trim()
          ? `<span class="corrected-word">${token}</span>`
          : token;
        preservedCorrected += token;
      }
      correctedIndex += length;
    } else if (part.removed) {
      for (let k = 0; k < length; k++) {
        const token = originalTokens[originalIndex + k];
        originalHighlighted += token.trim()
          ? `<span class="error-word">${token}</span>`
          : token;
      }
      originalIndex += length;
    } else {
      // Equal after quote normalization: emit the ORIGINAL characters on both
      // sides so quote style stays untouched and words aren't highlighted.
      const originalSlice = originalTokens.slice(originalIndex, originalIndex + length).join('');
      originalHighlighted += originalSlice;
      correctedHighlighted += originalSlice;
      preservedCorrected += originalSlice;
      originalIndex += length;
      correctedIndex += length;
    }
  }

  return { originalHighlighted, correctedHighlighted, preservedCorrected };
}

export function extractWordFixes(
  original: string,
  corrected: string,
  baseOffset: number,
): WordFix[] {
  const originalTokens = tokenize(original);
  const correctedTokens = tokenize(corrected);
  const parts = diffArrays(originalTokens.map(normalizeToken), correctedTokens.map(normalizeToken));

  // Sentence-relative start offset of each original token. Tokens are
  // contiguous slices of the original, so cumulative lengths give offsets.
  const originalStarts: number[] = [];
  let pos = 0;
  for (const token of originalTokens) {
    originalStarts.push(pos);
    pos += token.length;
  }

  const fixes: WordFix[] = [];
  let originalIndex = 0;
  let correctedIndex = 0;
  let pendingRemoved: Array<{ token: string; start: number }> = [];

  const emitDeletion = (removed: Array<{ token: string; start: number }>) => {
    const originalText = removed.map((r) => r.token).join('');
    if (originalText.trim() === '') return; // whitespace-only — nothing visible to click
    const last = removed[removed.length - 1];
    fixes.push({
      original: originalText,
      corrected: '',
      start: baseOffset + removed[0].start,
      end: baseOffset + last.start + last.token.length,
    });
  };

  for (const part of parts) {
    const value = Array.isArray(part.value) ? part.value : [part.value];
    if (part.removed) {
      for (let k = 0; k < value.length; k++) {
        const idx = originalIndex + k;
        pendingRemoved.push({ token: originalTokens[idx], start: originalStarts[idx] });
      }
      originalIndex += value.length;
    } else if (part.added) {
      const addedTokens = correctedTokens.slice(correctedIndex, correctedIndex + value.length);
      if (pendingRemoved.length > 0 && addedTokens.length > 0) {
        if (pendingRemoved.length === addedTokens.length) {
          // 1:1 pairing.
          for (let k = 0; k < pendingRemoved.length; k++) {
            const removed = pendingRemoved[k];
            const added = addedTokens[k];
            if (removed.token !== added && removed.token.trim() !== '' && added.trim() !== '') {
              fixes.push({
                original: removed.token,
                corrected: added,
                start: baseOffset + removed.start,
                end: baseOffset + removed.start + removed.token.length,
              });
            }
          }
        } else {
          // Unequal run. Pair as many leading tokens as possible 1:1; if the
          // leftovers are punctuation/whitespace only (e.g. 'slow' ->
          // 'slowly,'), emit them as a separate insertion so the comma shows
          // as its own marker in the editor. Otherwise keep the whole-run
          // joined fix (e.g. 'is are' -> 'was' must stay a single unit).
          const pairCount = Math.min(pendingRemoved.length, addedTokens.length);
          const leftoverRemoved = pendingRemoved.slice(pairCount);
          const leftoverAdded = addedTokens.slice(pairCount);
          // eslint-disable-next-line no-useless-escape -- the [ ] escapes are required here; unescaped [] matches nothing
          const punctOnly = (tokens: string[]) => tokens.every((t) => /^[\s.,!?;:'"()\[\]{}\u201C\u201D\u2018\u2019]*$/.test(t));
          if (punctOnly(leftoverRemoved.map((r) => r.token)) && punctOnly(leftoverAdded)) {
            for (let k = 0; k < pairCount; k++) {
              const removed = pendingRemoved[k];
              const added = addedTokens[k];
              if (removed.token !== added && removed.token.trim() !== '' && added.trim() !== '') {
                fixes.push({
                  original: removed.token,
                  corrected: added,
                  start: baseOffset + removed.start,
                  end: baseOffset + removed.start + removed.token.length,
                });
              }
            }
            const pairEnd = pendingRemoved[pairCount - 1].start + pendingRemoved[pairCount - 1].token.length;
            const addedText = leftoverAdded.join('');
            if (addedText.trim() !== '') {
              fixes.push({ original: '', corrected: addedText, start: baseOffset + pairEnd, end: baseOffset + pairEnd });
            }
            // leftoverRemoved is whitespace/punctuation only — nothing
            // visible to click, so no deletion fix is emitted.
          } else {
            const originalText = pendingRemoved.map((r) => r.token).join('');
            const addedText = addedTokens.join('');
            if (originalText.trim() !== '' && addedText.trim() !== '') {
              const last = pendingRemoved[pendingRemoved.length - 1];
              fixes.push({
                original: originalText,
                corrected: addedText,
                start: baseOffset + pendingRemoved[0].start,
                end: baseOffset + last.start + last.token.length,
              });
            }
          }
        }
      } else if (pendingRemoved.length === 0 && addedTokens.length > 0) {
        // Pure insertion: mark the point before the next original token.
        const addedText = addedTokens.join('');
        if (addedText.trim() !== '') {
          const insertAt = originalIndex < originalTokens.length
            ? originalStarts[originalIndex]
            : original.length;
          fixes.push({ original: '', corrected: addedText, start: baseOffset + insertAt, end: baseOffset + insertAt });
        }
      }
      pendingRemoved = [];
      correctedIndex += value.length;
    } else {
      // Equal part closes any pending change group; a removed run with no
      // added counterpart is a pure deletion.
      if (pendingRemoved.length > 0) emitDeletion(pendingRemoved);
      pendingRemoved = [];
      originalIndex += value.length;
      correctedIndex += value.length;
    }
  }

  // A removed run at the very end of the diff is also a pure deletion.
  if (pendingRemoved.length > 0) emitDeletion(pendingRemoved);

  return fixes;
}
