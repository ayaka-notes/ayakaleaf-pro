import type { SentenceData } from './types.js';

export function reconstructTextFromSentences(
  originalText: string,
  sentenceData: SentenceData[],
  correctedSentences: string[],
): string {
  if (sentenceData.length !== correctedSentences.length) return originalText;

  const resultParts: string[] = [];
  let lastSpanEnd = 0;

  for (let i = 0; i < sentenceData.length; i++) {
    const sent = sentenceData[i];
    const corrected = correctedSentences[i];
    const { start, end } = sent;
    const spanEnd = sent.spanEnd ?? end;
    const gapBeforeStart = sent.gapBeforeStart ?? lastSpanEnd;

    if (gapBeforeStart > lastSpanEnd) {
      resultParts.push(originalText.slice(lastSpanEnd, gapBeforeStart));
    } else if (start > lastSpanEnd) {
      resultParts.push(originalText.slice(lastSpanEnd, start));
    }

    resultParts.push(corrected);

    if (spanEnd > end) {
      resultParts.push(originalText.slice(end, spanEnd));
    } else if (i < sentenceData.length - 1) {
      if (end < originalText.length) {
        let whitespaceEnd = end;
        while (whitespaceEnd < originalText.length && /\s/.test(originalText[whitespaceEnd])) {
          whitespaceEnd++;
        }
        if (whitespaceEnd > end) {
          resultParts.push(originalText.slice(end, whitespaceEnd));
        } else if (corrected && /[.!?]$/.test(corrected) && whitespaceEnd < originalText.length) {
          const nextChar = originalText[whitespaceEnd];
          // Python: next_char.isalpha() and next_char.isupper()
          if (nextChar && /[A-Z]/.test(nextChar)) {
            resultParts.push(' ');
          }
        }
      }
    }

    lastSpanEnd = spanEnd;
  }

  if (lastSpanEnd < originalText.length) {
    resultParts.push(originalText.slice(lastSpanEnd));
  }

  return resultParts.join('');
}
