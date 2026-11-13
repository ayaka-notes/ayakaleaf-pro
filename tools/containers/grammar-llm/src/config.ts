import path from 'node:path';

const DEFAULT_MODEL_URL =
  'https://huggingface.co/icecubetr/GRMR-V3-G4B-GGUF/resolve/main/GRMR-V3-G4B-Q4_K_M.gguf';

export interface Sampling {
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
}

export interface Config {
  host: string;
  port: number;
  allowOrigin: string;

  /** Reported as the LanguageTool software version in response envelopes. */
  reportedVersion: string;

  modelDir: string;
  modelFile: string;
  modelUrl: string;
  modelPath: string;
  contextSize: number;
  concurrency: number;
  preload: boolean;

  maxTextLength: number;
  maxRuns: number; // 0 = unlimited checkable text runs per request
  requestTimeoutMs: number;
  sentenceTimeoutMs: number;
  maxBodyBytes: number;
  maxInFlight: number;

  /** Language codes accepted by /v2/check (lower-cased, includes 'auto'). */
  supportedLanguages: Set<string>;
  /** What to do for a non-English language code: 'empty' (silent) or 'error' (HTTP 400). */
  unsupportedLanguageMode: 'empty' | 'error';

  /** LLM backend: 'local' (node-llama-cpp) or 'openai' (OpenAI-compatible API). */
  backend: 'local' | 'openai';
  /**
   * Wire style for the 'openai' backend: 'openai' = standard /chat/completions
   * (OpenAI, vLLM, llama-server, …); 'ollama' = Ollama's native /api/chat
   * (needed for models like Qwen3 where the OpenAI-compat layer ignores
   * think:false and burns the token budget on hidden reasoning).
   */
  openaiStyle: 'openai' | 'ollama';
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1, a llama-server, vLLM, Ollama /v1, …). */
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  /** Timeout for a single remote LLM call (ms). */
  openaiTimeoutMs: number;

  /**
   * Optional real LanguageTool container to run IN PARALLEL (cascade) and
   * MERGE into the response: the final matches are the union of real-LT and
   * LLM findings (a span flagged by both becomes one match with combined
   * replacements). When LT finds nothing (or is down) the LLM result stands
   * alone; when the LLM has nothing, the LT result stands alone.
   * null = LLM only.
   */
  gtUrl: string | null;
  /** Timeout for the real-LanguageTool call (ms) — its window before the LLM result stands alone. */
  gtTimeoutMs: number;
  /**
   * Total wall-clock budget (ms) for a cascaded check (LT attempt + LLM
   * fallback). Kept under LT-client caps (Overleaf's controller times out at
   * 60 s and then shows nothing) so the response always arrives in time.
   */
  cascadeBudgetMs: number;

  /** Level used when the client does not send one ('default' or 'picky'). */
  defaultLevel: 'default' | 'picky';

  sampling: Sampling;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function envStr(env: NodeJS.ProcessEnv, key: string, def: string): string {
  const v = env[key];
  return v !== undefined && v !== '' ? v : def;
}
function envInt(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const v = env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${key} must be an integer, got ${v}`);
  return Math.trunc(n);
}
function envBool(env: NodeJS.ProcessEnv, key: string, def: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return def;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const contextSize = Math.min(131_072, Math.max(256, envInt(env, 'GRAMMAR_LLM_CONTEXT_SIZE', 8192)));
  const modelDir = envStr(env, 'GRAMMAR_LLM_MODEL_DIR', '/models');
  const modelFile = envStr(env, 'GRAMMAR_LLM_MODEL_FILE', 'GRMR-V3-G4B-Q4_K_M.gguf');
  const logLevel = (envStr(env, 'GRAMMAR_LLM_LOG_LEVEL', 'info').toLowerCase()) as Config['logLevel'];
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`GRAMMAR_LLM_LOG_LEVEL must be one of debug|info|warn|error, got '${env.GRAMMAR_LLM_LOG_LEVEL}'`);
  }
  const unsupportedLanguageMode = envStr(env, 'GRAMMAR_LLM_UNSUPPORTED_LANGUAGE', 'empty').toLowerCase();
  if (unsupportedLanguageMode !== 'empty' && unsupportedLanguageMode !== 'error') {
    throw new Error(`GRAMMAR_LLM_UNSUPPORTED_LANGUAGE must be 'empty' or 'error', got '${env.GRAMMAR_LLM_UNSUPPORTED_LANGUAGE}'`);
  }

  const backend = envStr(env, 'GRAMMAR_LLM_BACKEND', 'local').toLowerCase();
  if (backend !== 'local' && backend !== 'openai') {
    throw new Error(`GRAMMAR_LLM_BACKEND must be 'local' or 'openai', got '${env.GRAMMAR_LLM_BACKEND}'`);
  }
  const openaiStyleRaw = envStr(env, 'GRAMMAR_LLM_OPENAI_STYLE', 'openai').toLowerCase();
  if (openaiStyleRaw !== 'openai' && openaiStyleRaw !== 'ollama') {
    throw new Error(`GRAMMAR_LLM_OPENAI_STYLE must be 'openai' or 'ollama', got '${env.GRAMMAR_LLM_OPENAI_STYLE}'`);
  }
  const openaiModel = envStr(env, 'GRAMMAR_LLM_OPENAI_MODEL', '');
  if (backend === 'openai' && !openaiModel) {
    throw new Error('GRAMMAR_LLM_BACKEND=openai requires GRAMMAR_LLM_OPENAI_MODEL (e.g. gpt-4o-mini, or your GRMR model id on the server)');
  }
  const defaultLevel = envStr(env, 'GRAMMAR_LLM_DEFAULT_LEVEL', 'default').toLowerCase();
  if (defaultLevel !== 'default' && defaultLevel !== 'picky') {
    throw new Error(`GRAMMAR_LLM_DEFAULT_LEVEL must be 'default' or 'picky', got '${env.GRAMMAR_LLM_DEFAULT_LEVEL}'`);
  }
  const gtUrlRaw = envStr(env, 'GRAMMAR_LLM_LANGUAGETOOL_URL', '');
  if (gtUrlRaw && !/^https?:\/\//.test(gtUrlRaw)) {
    throw new Error(`GRAMMAR_LLM_LANGUAGETOOL_URL must be an http(s) URL, got '${gtUrlRaw}'`);
  }

  return {
    host: envStr(env, 'HOST', '0.0.0.0'),
    port: Math.max(1, Math.min(65535, envInt(env, 'PORT', 8010))),
    allowOrigin: envStr(env, 'GRAMMAR_LLM_ALLOW_ORIGIN', '*'),
    reportedVersion: envStr(env, 'GRAMMAR_LLM_REPORTED_LT_VERSION', '6.8'),

    modelDir,
    modelFile,
    modelUrl: envStr(env, 'GRAMMAR_LLM_MODEL_URL', DEFAULT_MODEL_URL),
    modelPath: path.join(modelDir, modelFile),
    contextSize,
    concurrency: Math.max(1, envInt(env, 'GRAMMAR_LLM_CONCURRENCY', 1)),
    preload: envBool(env, 'GRAMMAR_LLM_PRELOAD', true),

    maxTextLength: Math.max(1000, envInt(env, 'GRAMMAR_LLM_MAX_TEXT_LENGTH', 100_000)),
    maxRuns: Math.max(0, envInt(env, 'GRAMMAR_LLM_MAX_RUNS', 0)),
    requestTimeoutMs: Math.max(1000, envInt(env, 'GRAMMAR_LLM_REQUEST_TIMEOUT_MS', 55_000)),
    sentenceTimeoutMs: Math.max(1000, envInt(env, 'GRAMMAR_LLM_SENTENCE_TIMEOUT_MS', 20_000)),
    maxBodyBytes: Math.max(10 * 1024, envInt(env, 'GRAMMAR_LLM_MAX_BODY_BYTES', 2 * 1024 * 1024)),
    maxInFlight: Math.max(1, envInt(env, 'GRAMMAR_LLM_MAX_IN_FLIGHT', 4)),
    cascadeBudgetMs: Math.max(2000, envInt(env, 'GRAMMAR_LLM_CASCADE_BUDGET_MS', 55_000)),

    supportedLanguages: new Set(
      envStr(env, 'GRAMMAR_LLM_LANGUAGES', 'auto,en,en-us,en-gb,en-au,en-ca,en-ie,en-nz,en-za,en-in')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    unsupportedLanguageMode,

    backend,
    openaiStyle: openaiStyleRaw as 'openai' | 'ollama',
    openaiBaseUrl: envStr(env, 'GRAMMAR_LLM_OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
    openaiApiKey: envStr(env, 'GRAMMAR_LLM_OPENAI_API_KEY', ''),
    openaiModel,
    openaiTimeoutMs: Math.max(1000, envInt(env, 'GRAMMAR_LLM_OPENAI_TIMEOUT_MS', 60_000)),

    gtUrl: gtUrlRaw ? gtUrlRaw.replace(/\/$/, '') : null,
    gtTimeoutMs: Math.max(2000, envInt(env, 'GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS', 45_000)),

    defaultLevel: defaultLevel === 'picky' ? 'picky' : 'default',

    sampling: {
      temperature: Number(envStr(env, 'GRAMMAR_LLM_TEMPERATURE', '0.7')),
      topK: Math.max(1, envInt(env, 'GRAMMAR_LLM_TOP_K', 40)),
      topP: Number(envStr(env, 'GRAMMAR_LLM_TOP_P', '0.95')),
      minP: Number(envStr(env, 'GRAMMAR_LLM_MIN_P', '0.01')),
    },
    logLevel,
  };
}

export function isLanguageSupported(cfg: Config, code: string | null | undefined): boolean {
  if (code === undefined || code === null || String(code).trim() === '') return true; // LT default
  const c = String(code).trim().toLowerCase();
  return cfg.supportedLanguages.has(c);
}
