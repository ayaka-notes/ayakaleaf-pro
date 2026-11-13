import { splitIntoSentences } from './sentences.js';
import { cleanCorrectedText, isOnlyQuoteChange } from './clean.js';
import { highlightWordDifferences, extractWordFixes } from './diff.js';
import { reconstructTextFromSentences } from './reconstruct.js';
import type { CorrectionResponse, SentenceCorrector } from './types.js';

export function cleanQuotePunctuation(s: string): string {
  let result = s;
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(/([.!?])(["'])\s*\./g, '$1$2');
    result = result.replace(/([.!?])(["'])\s*\1/g, '$1$2');
    if (result === before) break;
  }
  return result;
}

export async function correctText(text: string, corrector: SentenceCorrector): Promise<CorrectionResponse> {
  const trimmed = text.trim();
  if (!trimmed) return { suggestions: [], correctedText: '' };

  const sentenceData = splitIntoSentences(text);
  const suggestions: CorrectionResponse['suggestions'] = [];
  const correctedSentences: string[] = [];

  for (let i = 0; i < sentenceData.length; i++) {
    const sent = sentenceData[i];
    const sentence = sent.text;

    if (sentence.length < 2) {
      correctedSentences.push(sentence);
      continue;
    }

    let corrected = await corrector.correct(sentence);
    corrected = cleanCorrectedText(corrected, sentence);

    if (isOnlyQuoteChange(sentence, corrected)) {
      corrected = sentence;
    }
    if (corrected.length > sentence.length * 2) {
      corrected = sentence;
    }

    corrected = cleanQuotePunctuation(corrected);

    // Diff once: restore the original quote style (curly vs straight) so
    // quote changes are never applied to the user's text.
    const diff = highlightWordDifferences(sentence, corrected);
    corrected = diff.preservedCorrected;
    correctedSentences.push(corrected);

    if (
      corrected.toLowerCase().trim() !== sentence.toLowerCase().trim() &&
      corrected.trim() !== sentence.trim() &&
      corrected.length <= sentence.length * 1.5 &&
      !isOnlyQuoteChange(sentence, corrected)
    ) {
      suggestions.push({
        original: sentence,
        corrected,
        sentence: `Sentence ${i + 1}`,
        start_index: sent.start,
        end_index: sent.end,
        original_highlighted: diff.originalHighlighted,
        corrected_highlighted: diff.correctedHighlighted,
        wordFixes: extractWordFixes(sentence, corrected, sent.start),
      });
    }
  }

  const correctedText = cleanQuotePunctuation(
    reconstructTextFromSentences(text, sentenceData, correctedSentences),
  );
  return { suggestions, correctedText };
}
