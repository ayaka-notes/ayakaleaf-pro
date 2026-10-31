// LLM inference wrapper. Mirrors grammar-llm's src/electron/llamaService.ts
// (SYSTEM_PROMPT, STOP_SEQUENCES, sampling params, per-sentence semantics) so
// the container produces the same corrections as the desktop app.
//
// node-llama-cpp v3.19 API (verified against the desktop's usage, which is
// itself "API verified against installed node-llama-cpp v3.19 types"):
//  - getLlama() auto-detects CUDA / Metal / Vulkan / CPU
//  - llama.loadModel({ modelPath }) -> model
//  - contextSize belongs on model.createContext(), not loadModel()
//  - sequences are created via context.getSequence()
//  - Sampling params (temperature/topK/topP/minP/maxTokens/repeatPenalty/
//    customStopTriggers) are per-prompt options for session.prompt(), NOT
//    session options.
//  - session.resetChatHistory() is called before each sentence.
//  - node-llama-cpp is ESM with top-level await, so it is loaded via dynamic
//    import() (see desktop modelManager.ts notes).

import type { Logger } from './log.js';

export interface Sampling {
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
}

export interface LlamaServiceOptions {
  modelPath: string;
  contextSize: number;
  sampling: Sampling;
  pickyExtraPrompt?: string;
  logger?: Logger;
}

/**
 * Check level (LanguageTool's `level` parameter).
 *  - 'default': base correction prompt — byte-identical to the desktop app.
 *  - 'picky':   base prompt + strict picky addendum (style, word choice,
 *               phrasing, punctuation — like LanguageTool's picky level
 *               adding rule families on top of the default set).
 */
export type CheckLevel = 'default' | 'picky';

export const SYSTEM_PROMPT =
  'You are a grammar correction assistant. Correct the grammar, spelling, and punctuation of the given text. Return only the corrected text without any additional explanations or prefixes.';

export const DEFAULT_PICKY_EXTRA =
  'Additionally, be highly picky, like a careful editor: also fix word choice, awkward or redundant phrasing, weak punctuation, and style issues. Prefer the most precise and idiomatic English. ';

export const STOP_SEQUENCES = ['<|endoftext|>', '<|corrected_end|>', '\n\n', 'Corrected:', 'Here is'];

interface SessionLike {
  resetChatHistory(): void;
  prompt(sentence: string, options: Record<string, unknown>): Promise<unknown>;
}

export class LlamaService {
  private baseSession: SessionLike | null = null;
  private pickySession: SessionLike | null = null;
  private loading: Promise<void> | null = null;
  private loadError: unknown = null;

  readonly modelPath: string;
  readonly contextSize: number;
  readonly sampling: Sampling;
  readonly pickyExtraPrompt: string;
  private log: Logger;

  constructor(opts: LlamaServiceOptions, log?: Logger) {
    this.modelPath = opts.modelPath;
    this.contextSize = opts.contextSize;
    this.sampling = opts.sampling;
    this.pickyExtraPrompt = opts.pickyExtraPrompt ?? DEFAULT_PICKY_EXTRA;
    this.log = log ?? defaultLogger;
  }

  get loadErrorText(): string | null {
    return this.loadError ? String(this.loadError) : null;
  }

  get isReady(): boolean {
    return this.baseSession !== null;
  }

  async ensureLoaded(): Promise<void> {
    if (this.baseSession) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      if (!this.modelPath) throw new Error('No model path configured');
      // Dynamic import: node-llama-cpp is ESM with top-level await.
      const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
      const llama = await getLlama(); // auto-detects CUDA / Metal / Vulkan / CPU
      const model = await llama.loadModel({ modelPath: this.modelPath });
      // sequences: 2 → one chat session per level (shared KV cache context).
      const context = await model.createContext({ contextSize: this.contextSize, sequences: 2 });
      // Two chat sessions on the shared KV context (separate sequences):
      //  - base:   the desktop system prompt (default level = desktop parity)
      //  - picky:  base + picky addendum in the SYSTEM slot. (A GRMR fine-tune
      //            echoes instructions placed in the user message, so the
      //            addendum must not go there.)
      this.baseSession = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: SYSTEM_PROMPT,
      }) as unknown as SessionLike;
      this.pickySession = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: SYSTEM_PROMPT + ' ' + this.pickyExtraPrompt,
      }) as unknown as SessionLike;
      this.log.info('model loaded and ready', {
        modelPath: this.modelPath,
        contextSize: this.contextSize,
        levels: ['default(base)', 'picky(base+editor addendum)'],
      });
    })();

    try {
      await this.loading;
    } catch (err) {
      this.loadError = err;
      this.log.error('failed to load model', { err: String(err) });
      throw err;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Correct a single sentence — raw sentence in the user slot (desktop
   * parity; GRMR fine-tunes echo user-slot instructions, so never put
   * instructions there). Per-level selection happens via the session's
   * system prompt (base vs base+picky addendum).
   * Mirrors the desktop corrector: reset chat history, per-prompt sampling,
   * trim, fall back to the original sentence on error so the pipeline keeps
   * going.
   */
  async correct(sentence: string, level: CheckLevel = 'default'): Promise<string> {
    await this.ensureLoaded();
    const session = level === 'picky' ? this.pickySession : this.baseSession;
    if (!session) throw new Error('session not ready');
    try {
      session.resetChatHistory();
      const response = (await session.prompt(sentence, {
        maxTokens: sentence.length + 20,
        temperature: this.sampling.temperature,
        topK: this.sampling.topK,
        topP: this.sampling.topP,
        minP: this.sampling.minP,
        repeatPenalty: { penalty: 1 }, // penalty 1 = disabled (desktop parity)
        customStopTriggers: STOP_SEQUENCES,
      })) as unknown as string;
      return response.trim();
    } catch (error) {
      this.log.error(`Error correcting sentence '${sentence}':`, { err: String(error) });
      return sentence;
    }
  }
}

const defaultLogger: Logger = {
  debug: () => undefined,
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m, x) => console.error(m, x ? String(x) : ''),
};
