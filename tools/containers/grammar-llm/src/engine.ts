// Check engine: runs the grammar-llm core pipeline (sentence splitting, LLM
// correction, cleaning, diff/word-fix extraction, reconstruction) over the
// plain-text runs of a document, with a per-request time budget.
//
// The per-sentence guard pipeline mirrors grammar-llm's core/correction.ts
// (correctText) exactly — same order of guards, same suggestion shape — so
// container results stay identical to the desktop app for the same model.

import { cleanCorrectedText, isOnlyQuoteChange } from '../core/clean.js';
import { cleanQuotePunctuation } from '../core/correction.js';
import { extractWordFixes, highlightWordDifferences } from '../core/diff.js';
import { reconstructTextFromSentences } from '../core/reconstruct.js';
import { splitIntoSentences } from '../core/sentences.js';
import type { CorrectionResponse, Suggestion } from '../core/types.js';
import { LlamaService, type CheckLevel } from './llama.js';
import { OpenAIService } from './openai.js';
import type { Config } from './config.js';
import type { Logger } from './log.js';
import type { TextRun } from './languagetool.js';

/** Common contract of the two backends (local node-llama-cpp / OpenAI-compatible). */
interface SentenceBackend {
  isReady: boolean;
  ensureLoaded(): Promise<void>;
  correct(sentence: string, level: CheckLevel): Promise<string>;
  loadErrorText: string | null;
  describe(): string;
}

function describeLocal(svc: LlamaService): string {
  return `local model=${svc.modelPath}`;
}

export type EngineState = 'stopped' | 'loading' | 'ready' | 'error';

export interface EngineStatus {
  state: EngineState;
  errorMessage: string | null;
  modelPath: string;
  checksCompleted: number;
  checksFailed: number;
}

export interface RunCheckResult extends CorrectionResponse {
  /** true when the request time budget cut the check short. */
  incomplete: boolean;
}

export class CheckEngine {
  private backend: SentenceBackend;
  private localLlama: LlamaService | null = null;
  private state: EngineState = 'stopped';
  private loadError: string | null = null;
  private loading: Promise<void> | null = null;
  /**
   * Serialization chain: the LLM backend keeps ONE shared chat context
   * (resetChatHistory() per sentence), so concurrent checks must not interleave.
   * Checks queue here; each keeps its own internal deadline semantics.
   */
  private checkChain: Promise<unknown> = Promise.resolve();
  checksCompleted = 0;
  checksFailed = 0;

  constructor(private cfg: Config, private log: Logger) {
    if (cfg.backend === 'openai') {
      this.backend = new OpenAIService({
        baseUrl: cfg.openaiBaseUrl,
        apiKey: cfg.openaiApiKey,
        model: cfg.openaiModel,
        sampling: cfg.sampling,
        timeoutMs: cfg.openaiTimeoutMs,
        tokenPad: cfg.openaiMaxTokenPad,
        logger: log,
        style: cfg.openaiStyle,
        systemPrompt: cfg.openaiSystemPrompt || undefined,
      });
    } else {
      const svc = new LlamaService(
        {
          modelPath: cfg.modelPath,
          contextSize: cfg.contextSize,
          sampling: cfg.sampling,
          logger: log,
        },
        log,
      );
      this.localLlama = svc;
      this.backend = {
        isReady: svc.isReady,
        ensureLoaded: () => svc.ensureLoaded(),
        correct: (s, l) => svc.correct(s, l),
        get loadErrorText() {
          return svc.loadErrorText;
        },
        describe: () => describeLocal(svc),
      };
    }
  }

  status(): EngineStatus {
    return {
      state: this.state,
      errorMessage: this.loadError ?? this.backend.loadErrorText,
      modelPath: this.cfg.backend === 'openai' ? `(remote: ${this.cfg.openaiModel})` : this.cfg.modelPath,
      checksCompleted: this.checksCompleted,
      checksFailed: this.checksFailed,
    };
  }

  async ensureReady(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.loading) await this.loading;
    if (this.state === 'ready') return;
    this.state = 'loading';
    this.loading = this.backend
      .ensureLoaded()
      .then(() => {
        this.state = 'ready';
        this.loadError = null;
      })
      .catch((err) => {
        this.state = 'error';
        this.loadError = String(err);
        throw err;
      })
      .finally(() => {
        this.loading = null;
      });
    await this.loading;
  }

  /** Check a single plain-text run. Never throws for per-sentence failures. */
  async correctRun(run: TextRun, deadline: number, level: CheckLevel = 'default'): Promise<RunCheckResult> {
    const text = run.text;
    const trimmed = text.trim();
    if (!trimmed) return { suggestions: [], correctedText: '', incomplete: false };

    const sentenceData = splitIntoSentences(text);
    const n = sentenceData.length;
    const deadlineExceeded = () => Date.now() > deadline;

    // Process sentences one at a time (single shared LLM session), stopping
    // at the request deadline; unprocessed sentences pass through unchanged.
    const suggestions: Suggestion[] = [];
    const correctedSentences: string[] = [];
    let incomplete = false;

    for (let i = 0; i < n; i++) {
      const sent = sentenceData[i];
      const sentence = sent.text;
      if (sentence.length < 2) {
        correctedSentences.push(sentence);
        continue;
      }
      if (deadlineExceeded()) {
        incomplete = true;
        correctedSentences.push(sentence);
        continue;
      }
      let corrected = await this.backend.correct(sentence, level);
      corrected = cleanCorrectedText(corrected, sentence);
      if (isOnlyQuoteChange(sentence, corrected)) corrected = sentence;
      if (corrected.length > sentence.length * 2) corrected = sentence;
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

    const correctedText = cleanQuotePunctuation(reconstructTextFromSentences(text, sentenceData, correctedSentences));
    return { suggestions, correctedText, incomplete };
  }

  /**
   * Check all runs of a resolved input (sequentially; each run is bounded by
   * the shared deadline). Returns per-run results in order.
   * Concurrent callers are serialized on the shared LLM context.
   */
  check(
    runs: TextRun[],
    opts: { maxRuns?: number; requestTimeoutMs?: number; level?: CheckLevel },
  ): Promise<{ results: RunCheckResult[]; incomplete: boolean }> {
    const task = this.checkChain.then(() => this.runCheck(runs, opts));
    // Keep the chain alive without swallowing task errors for the caller.
    this.checkChain = task.catch(() => { /* errors reach the caller via `task` */ });
    return task;
  }

  private async runCheck(
    runs: TextRun[],
    opts: { maxRuns?: number; requestTimeoutMs?: number; level?: CheckLevel },
  ): Promise<{ results: RunCheckResult[]; incomplete: boolean }> {
    await this.ensureReady();
    const start = Date.now();
    const budget = opts.requestTimeoutMs ?? this.cfg.requestTimeoutMs;
    const deadline = start + budget;
    const maxRuns = opts.maxRuns ?? this.cfg.maxRuns;
    const level = opts.level ?? this.cfg.defaultLevel;

    const results: RunCheckResult[] = [];
    let incomplete = false;
    const considered = maxRuns > 0 ? runs.slice(0, maxRuns) : runs;
    if (maxRuns > 0 && runs.length > maxRuns) incomplete = true;

    for (let i = 0; i < considered.length; i++) {
      const run = considered[i];
      if (Date.now() > deadline) {
        incomplete = true;
        this.log.warn('check time budget exhausted; remaining sentences passed through unchanged', {
          budgetMs: budget,
          ranMs: Date.now() - start,
          run: i,
        });
        results.push({ suggestions: [], correctedText: run.text, incomplete: true });
        continue;
      }
      try {
        const r = await this.correctRun(run, deadline, level);
        results.push(r);
        if (r.incomplete) incomplete = true;
      } catch (err) {
        this.checksFailed++;
        this.log.error('check run failed', { err: String(err) });
        results.push({ suggestions: [], correctedText: run.text, incomplete: true });
        incomplete = true;
      }
    }
    this.checksCompleted++;
    this.log.info('check completed', {
      backend: this.backend.describe(),
      level,
      runs: results.length,
      suggestions: results.reduce((a, r) => a + r.suggestions.length, 0),
      ranMs: Date.now() - start,
      incomplete,
    });
    return { results, incomplete };
  }
}

export interface SentenceCorrectorShim {
  correct(sentence: string): Promise<string>;
}
