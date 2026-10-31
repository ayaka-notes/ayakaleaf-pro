// OpenAI-compatible (chat/completions) backend — same contract as LlamaService
// so an Overleaf server without local inference capacity can redirect the LLM
// step to a hosted model (OpenAI, OpenRouter, vLLM, llama.cpp llama-server,
// Ollama /v1, a self-hosted GRMR-V3 LoRA endpoint, …).
//
// Prompt/stop/sampling semantics match src/llama.ts (and therefore the
// grammar-llm desktop app): same system prompt, same level addendum, same
// stop sequences, same sampling, same "fall back to the original sentence on
// error" behavior so the pipeline keeps going.

import type { Logger } from './log.js';
import type { Sampling, CheckLevel } from './llama.js';
import { SYSTEM_PROMPT, DEFAULT_PICKY_EXTRA, STOP_SEQUENCES } from './llama.js';

export interface OpenAIServiceOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  sampling: Sampling;
  timeoutMs: number;
  /** completion-token headroom over sentence length (num_predict / max_tokens margin). */
  tokenPad?: number;
  pickyExtraPrompt?: string;
  /** Custom base system prompt (e.g. a fine-tune's trained prompt). Undefined = built-in. */
  systemPrompt?: string;
  logger?: Logger;
  /** 'openai' = /chat/completions (default); 'ollama' = native /api/chat with think:false. */
  style?: 'openai' | 'ollama';
}

export class OpenAIService {
  readonly model: string;
  private baseUrl: string;
  private apiKey: string;
  private sampling: Sampling;
  private timeoutMs: number;
  private tokenPad: number;
  private pickyExtraPrompt: string;
  private sysPrompt: string;
  private log: Logger;
  private style: 'openai' | 'ollama';
  private pingDone = false;

  constructor(opts: OpenAIServiceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    if (opts.style === 'ollama') this.baseUrl = this.baseUrl.replace(/\/v1$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.sampling = opts.sampling;
    this.timeoutMs = opts.timeoutMs;
    this.tokenPad = Math.max(0, opts.tokenPad ?? 40);
    this.pickyExtraPrompt = opts.pickyExtraPrompt ?? DEFAULT_PICKY_EXTRA;
    this.sysPrompt = (opts.systemPrompt ?? '').trim();
    this.log = opts.logger ?? defaultLogger;
    this.style = opts.style ?? 'openai';
  }

  get isReady(): boolean {
    return true; // remote backend — readiness is a connectivity question
  }

  get loadErrorText(): string | null {
    return null;
  }

  /** No local model to load. Best-effort availability ping (never fatal). */
  async ensureLoaded(): Promise<void> {
    if (this.pingDone) return;
    this.pingDone = true;
    this.log.info('openai-compatible backend', { baseUrl: this.baseUrl, model: this.model, style: this.style });
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(`${this.baseUrl}/${this.style === 'ollama' ? 'api/tags' : 'models'}`, {
        headers: this.authHeaders(),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!r.ok) this.log.warn('model list endpoint not reachable/ok (will still attempt completions)', { status: r.status });
    } catch (err) {
      this.log.warn('model list endpoint unreachable (will still attempt completions)', { err: String(err) });
    }
  }

  describe(): string {
    return `openai:${this.baseUrl} model=${this.model}`;
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  /**
   * One chat call per sentence. `level === 'picky'` uses the system prompt +
   * picky addendum; 'default' is the base prompt (identical to the desktop
   * app). Returns the original sentence on any error.
   */
  async correct(sentence: string, level: CheckLevel = 'default'): Promise<string> {
    const base = this.sysPrompt || SYSTEM_PROMPT;
    const system = level === 'picky' ? `${base} ${this.pickyExtraPrompt}` : base;
    if (this.style === 'ollama') return this.correctOllama(sentence, system);
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: sentence },
      ],
      temperature: this.sampling.temperature,
      top_p: this.sampling.topP,
      top_k: this.sampling.topK,
      max_tokens: sentence.length + this.tokenPad,
      stop: STOP_SEQUENCES,
    };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.timeoutMs);
      const r = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        this.log.error('openai backend error', { status: r.status, body: text.slice(0, 300) });
        return sentence;
      }
      const json: { choices?: Array<{ message?: { content?: string } }> } = await r.json();
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        this.log.error('openai backend returned no usable content', {});
        return sentence;
      }
      return content.trim();
    } catch (err) {
      this.log.error(`Error correcting sentence '${sentence}' via openai backend:`, { err: String(err) });
      return sentence;
    }
  }

  /**
   * Ollama native /api/chat path. Used for Qwen3-family and similar thinking
   * models: the OpenAI-compat layer of this Ollama build ignores the
   * top-level think flag and ~100× burns the completion budget on hidden
   * reasoning (measured: 111–400 completion tokens for ~15-token answers,
   * occasionally hitting max_tokens with an EMPTY answer). Native think:false
   * suppresses reasoning entirely (measured: ~15 completion tokens, same
   * answer) — same contract, deterministic budget.
   */
  private async correctOllama(sentence: string, system: string): Promise<string> {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: sentence },
      ],
      stream: false,
      think: false,
      options: {
        temperature: this.sampling.temperature,
        top_k: this.sampling.topK,
        top_p: this.sampling.topP,
        stop: STOP_SEQUENCES,
        num_predict: Math.max(sentence.length + this.tokenPad, 128),
      },
    };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.timeoutMs);
      const r = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        this.log.error('ollama backend error', { status: r.status, body: text.slice(0, 300) });
        return sentence;
      }
      const json: { message?: { content?: string } } = await r.json();
      const content = json.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        this.log.error('ollama backend returned no usable content', {});
        return sentence;
      }
      return content.trim();
    } catch (err) {
      this.log.error(`Error correcting sentence '${sentence}' via ollama backend:`, { err: String(err) });
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
