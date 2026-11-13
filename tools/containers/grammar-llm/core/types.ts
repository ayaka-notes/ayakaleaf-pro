export interface SentenceData {
  text: string;
  start: number;
  end: number;
  spanEnd: number;
  gapBeforeStart: number;
}

export interface Suggestion {
  original: string;
  corrected: string;
  sentence: string;
  start_index: number;
  end_index: number;
  original_highlighted: string;
  corrected_highlighted: string;
  wordFixes: WordFix[];
}

export interface WordFix {
  original: string;   // misspelled word as it appears in the text
  corrected: string;  // replacement word
  start: number;      // absolute offset in the full input text
  end: number;        // absolute offset (exclusive)
}

export interface CorrectionResponse {
  suggestions: Suggestion[];
  correctedText: string;
}

export interface SentenceCorrector {
  correct(sentence: string): Promise<string>;
}
