// grammar-llm server — LanguageTool-compatible HTTP API (v2).
//
// Endpoints:
//   GET  /v2/languages   LanguageTool language list
//   POST /v2/check       grammar check (form-urlencoded or JSON body)
//   GET  /v2/version     version info
//   GET  /v2/health      engine/model status (container HEALTHCHECK)
//   GET  /               short info payload
//
// Drop-in for erikvl87/languagetool (docker-languagetool): same default port
// (8010), same wire API, `GET /v2/languages` + `POST /v2/check` semantics.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { isLanguageSupported, loadConfig, type Config } from './config.js';
import { CheckEngine, type CheckEngine } from './engine.js';
import { createLogger, type Logger } from './log.js';
import {
  buildCheckResponse,
  getLanguages,
  resolveCheckInput,
  suggestionToMatches,
  type LtMatch,
  type TextRun,
} from './languagetool.js';
import { splitIntoSentences } from '../core/sentences.js';
import type { Suggestion } from '../core/types.js';

// Re-export for consumers/tests (e.g. building the real engine with the
// openai backend directly).
export { CheckEngine };

/** LLM half of a check (cascade race participant). */
interface LlmOutcome {
  status: number;
  body: unknown;
}

/** True when a check response body carries at least one match. */
function bodyHasMatches(body: unknown): boolean {
  const m = (body as { matches?: unknown[] } | null | undefined)?.matches;
  return Array.isArray(m) && m.length > 0;
}

function matchCount(body: unknown): number {
  const m = (body as { matches?: unknown[] } | null | undefined)?.matches;
  return Array.isArray(m) ? m.length : 0;
}

type MatchRecord = Record<string, unknown>;

function spanKey(m: MatchRecord): string {
  return `${m['offset']}:${m['length']}`;
}

/**
 * Merge the real-LanguageTool response with the LLM response (A+B):
 *  - real-LT matches first, in LT order;
 *  - LLM-only matches appended, in LLM order;
 *  - a span flagged by BOTH tools becomes ONE match (the real-LT one, whose
 *    rule/category/message stay authoritative) with the LLM's distinct
 *    replacement candidates appended to its `replacements` list;
 *  - envelope (`software`, `warnings`, `sentenceRanges`, …) comes from the
 *    real-LT response, with the LLM's `incompleteResults` warning and
 *    sentence ranges folded in.
 */
function mergeLtAndLlm(lt: Record<string, unknown>, llmBody: unknown): Record<string, unknown> {
  const llm = (llmBody ?? {}) as Record<string, unknown>;
  const ltMatches = Array.isArray(lt['matches']) ? (lt['matches'] as MatchRecord[]) : [];
  const llmMatches = Array.isArray(llm['matches']) ? (llm['matches'] as MatchRecord[]) : [];
  const ltKeys = new Set(ltMatches.map(spanKey));

  const mergedMatches: MatchRecord[] = [];
  for (const m of ltMatches) {
    const k = spanKey(m);
    const llmM = llmMatches.find((x) => spanKey(x) === k);
    if (!llmM) {
      mergedMatches.push(m);
      continue;
    }
    // Both tools flagged the exact same span: keep the LT match, append the
    // LLM's distinct replacement candidates (no duplicate values).
    const replacements: Array<Record<string, unknown>> = [
      ...(((m['replacements'] as unknown) as Array<Record<string, unknown>> | undefined) ?? []),
    ];
    const have = new Set(replacements.map((r) => String(r['value'])));
    for (const r of ((llmM['replacements'] as unknown) as Array<Record<string, unknown>> | undefined) ?? []) {
      const v = String(r['value']);
      if (!have.has(v)) {
        replacements.push(r);
        have.add(v);
      }
    }
    mergedMatches.push({ ...m, replacements });
  }
  for (const m of llmMatches) {
    if (!ltKeys.has(spanKey(m))) mergedMatches.push(m);
  }

  const merged = { ...lt };
  merged['matches'] = mergedMatches;
  const ltWarn = (lt['warnings'] ?? {}) as Record<string, unknown>;
  const llmWarn = (llm['warnings'] ?? {}) as Record<string, unknown>;
  const warnings: Record<string, unknown> = { ...ltWarn, ...llmWarn };
  if (ltWarn['incompleteResults'] === true || llmWarn['incompleteResults'] === true) {
    warnings['incompleteResults'] = true;
  }
  merged['warnings'] = warnings;
  const ranges = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const ltRanges = ranges<[number, number]>(lt['sentenceRanges']);
  const llmRanges = ranges<[number, number]>(llm['sentenceRanges']);
  if (ltRanges.length > 0 || llmRanges.length > 0) {
    merged['sentenceRanges'] = [...ltRanges, ...llmRanges].sort((a, b) => a[0] - b[0]);
  }
  return merged;
}

export interface EngineLike {
  status(): {
    state: string;
    errorMessage: string | null;
    modelPath: string;
    checksCompleted: number;
    checksFailed: number;
  };
  ensureReady(): Promise<void>;
  check(
    runs: TextRun[],
    opts: { maxRuns?: number; requestTimeoutMs?: number; level?: 'default' | 'picky' },
  ): Promise<{ results: Array<{ suggestions: Suggestion[]; correctedText: string; incomplete: boolean }>; incomplete: boolean }>;
}

export interface ServerDeps {
  cfg: Config;
  engine: EngineLike;
  log?: Logger;
}

interface RequestBody {
  params: Record<string, string | undefined>;
  json: Record<string, unknown> | null;
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

function parseRequestBody(body: string, req: http.IncomingMessage): RequestBody {
  const ctype = String(req.headers['content-type'] ?? '').toLowerCase();
  const params: Record<string, string | undefined> = {};
  let json: Record<string, unknown> | null = null;

  if (ctype.includes('application/json')) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      json = parsed;
      // Also expose scalar params (some clients mix both encodings).
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') params[k] = v;
      }
    } catch {
      // fall through to urlencoded
    }
  }
  if (!json && (ctype.includes('application/x-www-form-urlencoded') || ctype === '' || ctype.includes('text/plain'))) {
    const sp = new URLSearchParams(body);
    for (const [k, v] of sp.entries()) {
      params[k] = v;
    }
    // If it was actually JSON (no content-type), be helpful.
    if (params['text'] === undefined && params['data'] === undefined && body.trim().startsWith('{')) {
      try {
        json = JSON.parse(body) as Record<string, unknown>;
        for (const [k, v] of Object.entries(json)) {
          if (typeof v === 'string') params[k] = v;
        }
      } catch {
        /* not JSON after all */
      }
    }
  }
  return { params, json };
}

function jsonOut(res: http.ServerResponse, status: number, obj: unknown, allowOrigin: string): void {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowOrigin,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function errorOut(res: http.ServerResponse, status: number, message: string, allowOrigin: string): void {
  jsonOut(res, status, { message }, allowOrigin);
}

export class LtServer {
  private inFlight = 0;
  private readonly log: Logger;

  constructor(private deps: ServerDeps) {
    this.log = deps.log ?? createLogger(deps.cfg.logLevel);
    this.httpServer = http.createServer((req, res) => {
      this.log.debug('request', { method: req.method, url: req.url ?? '' });
      void this.handle(req, res).catch((err) => {
        this.log.error('unhandled error', { err: String(err) });
        if (!res.headersSent) errorOut(res, 500, 'internal error', deps.cfg.allowOrigin);
        else res.end();
      });
    });
  }

  readonly httpServer: http.Server;

  listen(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(port, host, () => {
        this.log.info(`listening on http://${host}:${port} (LanguageTool-compatible API)`);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.httpServer.close(() => resolve()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { cfg } = this.deps;
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': cfg.allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (method === 'GET' && (path === '/v2/languages' || path === '/languages')) {
      jsonOut(res, 200, getLanguages(), cfg.allowOrigin);
      return;
    }

    if (method === 'GET' && path === '/v2/version') {
      jsonOut(res, 200, this.versionObject(), cfg.allowOrigin);
      return;
    }

    if (method === 'GET' && (path === '/v2/health' || path === '/healthz' || path === '/health')) {
      this.handleHealth(res);
      return;
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      jsonOut(res, 200, { ...this.versionObject(), endpoints: ['/v2/languages', 'POST /v2/check', '/v2/version', '/v2/health'] }, cfg.allowOrigin);
      return;
    }

    if (method === 'POST' && (path === '/v2/check' || path === '/check')) {
      await this.handleCheck(req, res, url);
      return;
    }

    if (path.startsWith('/v2/')) {
      errorOut(res, 404, `unknown v2 endpoint: ${path}`, cfg.allowOrigin);
      return;
    }
    errorOut(res, 404, `not found: ${path}`, cfg.allowOrigin);
  }

  private versionObject(): Record<string, unknown> {
    const { cfg } = this.deps;
    const st = this.deps.engine.status();
    return {
      name: 'LanguageTool',
      version: cfg.reportedVersion,
      apiVersion: 1,
      engine: {
        name: 'grammar-llm',
        backend: cfg.backend,
        ...(cfg.backend === 'openai' ? { model: cfg.openaiModel } : { model: cfg.modelFile }),
        state: st.state,
      },
      languageToolProxy: cfg.gtUrl ?? null,
      defaultLevel: cfg.defaultLevel,
    };
  }

  private handleHealth(res: http.ServerResponse): void {
    const { cfg } = this.deps;
    const st = this.deps.engine.status();
    const ok = st.state === 'ready';
    jsonOut(res, ok ? 200 : 503, {
      status: ok ? 'ok' : 'degraded',
      state: st.state,
      ...(st.errorMessage ? { error: st.errorMessage } : {}),
      model: {
        file: cfg.modelFile,
        path: cfg.modelPath,
      },
      checks: { completed: st.checksCompleted, failed: st.checksFailed },
      backend: cfg.backend,
      languageToolProxy: cfg.gtUrl ?? null,
      defaultLevel: cfg.defaultLevel,
      inFlight: this.inFlight,
      version: cfg.reportedVersion,
      uptimeSec: Math.round(process.uptime()),
    }, cfg.allowOrigin);
  }

  /**
   * Forward the request to a real LanguageTool container (v2 API), exactly
   * like LanguageTool itself would see it:
   *  - original `text` or `data` (annotation) payload — LT handles Overleaf's
   *    LaTeX annotations natively and returns offsets in editor-document space
   *  - `level` always present ('picky'→'picky', otherwise 'default')
   *  - `disabledRules` / `language` passed through
   * Returns the LT response when it produced ≥1 match, otherwise null (the
   * caller then runs the LLM). Never throws — LT failure means "try the LLM".
   */
  private async forwardToLanguagetool(args: {
    cfg: Config;
    body: Buffer;
    params: Record<string, string | undefined>;
    bodyObj: Record<string, unknown>;
    language: string;
    level: 'default' | 'picky';
    deadline: number;
  }): Promise<Record<string, unknown> | null> {
    const { cfg, body, params, bodyObj, language, level, deadline } = args;
    const gtUrl = cfg.gtUrl;
    if (!gtUrl) return null;

    // Rebuild a clean form body from the merged params (LT v2 is form-based).
    const text = typeof bodyObj['text'] === 'string' ? bodyObj['text'] : params['text'];
    const data = typeof bodyObj['data'] === 'string' ? bodyObj['data'] : bodyObj['data'] ? JSON.stringify(bodyObj['data']) : params['data'];
    if (!text && !data) return null; // nothing to forward (caller 400s)

    const form = new URLSearchParams();
    form.set('language', language);
    form.set('level', level); // ← the picky flag, always explicit
    if (typeof text === 'string') form.set('text', text);
    if (typeof data === 'string') form.set('data', data);
    const disabledRules = params['disabledRules'];
    if (disabledRules) form.set('disabledRules', disabledRules);

    const remaining = Math.max(500, Math.min(cfg.gtTimeoutMs, deadline - Date.now()));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), remaining);
    try {
      const res = await fetch(`${gtUrl}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: ctl.signal,
      });
      if (!res.ok) {
        this.log.warn('real LanguageTool returned an error — falling back to grammar-llm', { status: res.status });
        return null;
      }
      const json = (await res.json()) as Record<string, unknown>;
      const matches = Array.isArray(json['matches']) ? (json['matches'] as unknown[]) : [];
      if (matches.length === 0) return null; // nothing found → LLM runs second
      // Pass the genuine LT response through (add missing envelope bits if
      // the upstream LT is an unusual build).
      if (json['software'] === undefined) json['software'] = { name: 'LanguageTool', version: cfg.reportedVersion, apiVersion: 1 };
      if (json['warnings'] === undefined) json['warnings'] = { incompleteResults: false };
      return json;
    } catch (err) {
      this.log.warn('real LanguageTool unreachable — falling back to grammar-llm', { err: String(err), gtUrl });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleCheck(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const { cfg, engine } = this.deps;

    // In-flight guard (protect the single LLM session from pileups).
    if (this.inFlight >= cfg.maxInFlight) {
      errorOut(res, 503, 'server busy — too many checks in flight, retry shortly', cfg.allowOrigin);
      return;
    }
    this.inFlight++;
    try {
      const body = await readBody(req, cfg.maxBodyBytes).catch((err: unknown) => {
        if ((err as { statusCode?: number })?.statusCode === 413) {
          errorOut(res, 413, 'request body too large', cfg.allowOrigin);
          return null;
        }
        throw err;
      });
      if (body === null) return;

      // Query-string params may also carry the request (LT allows both); merged into bodyObj below.

      const parsed = parseRequestBody(body.toString('utf8'), req);
      const bodyObj: Record<string, unknown> = parsed.json ?? {};
      // LanguageTool accepts text/data/level/language as query or body params;
      // merge so both styles work.
      if (bodyObj['text'] === undefined && parsed.params['text'] !== undefined) bodyObj['text'] = parsed.params['text'];
      if (bodyObj['data'] === undefined && parsed.params['data'] !== undefined) bodyObj['data'] = parsed.params['data'];
      const params: Record<string, string | undefined> = {
        ...Object.fromEntries(url.searchParams.entries()),
        ...Object.fromEntries(Object.entries(parsed.params)),
      };

      const language = params['language'] ?? 'auto';
      // LanguageTool's `level`: 'picky' or 'default'. The level is ALWAYS forwarded
      // to the real LanguageTool container (picky→picky) and drives the LLM mode.
      const levelRaw = String(params['level'] ?? bodyObj['level'] ?? '').trim().toLowerCase();
      const level: 'default' | 'picky' = levelRaw === 'picky' ? 'picky' : levelRaw === 'default' ? 'default' : cfg.defaultLevel;
      if (levelRaw) this.log.debug('level requested', { levelRaw, resolved: level });
      const disabledRules = params['disabledRules'] ?? (parsed.json?.['disabledRules'] as string | undefined);
      if (disabledRules) this.log.debug('disabledRules (forwarded to real LT when configured; ignored by grammar-llm)', { disabledRules });

      // 2) resolve text/runs (also validates text length)
      const input = resolveCheckInput(bodyObj);
      if ('error' in input) {
        errorOut(res, 400, input.error, cfg.allowOrigin);
        return;
      }
      const fullText = input.text;
      if (fullText.trim().length === 0) {
        jsonOut(res, 200, buildCheckResponse({ fullText, matches: [], sentenceRanges: [], languageCode: language, reportedVersion: cfg.reportedVersion }), cfg.allowOrigin);
        return;
      }
      if (fullText.length > cfg.maxTextLength) {
        errorOut(res, 413, `text too long (${fullText.length} > ${cfg.maxTextLength})`, cfg.allowOrigin);
        return;
      }

      // 3) CASCADE (when a real LanguageTool is configured): run the real LT
      // and the LLM IN PARALLEL on ONE shared wall-clock budget
      // (cascadeBudgetMs, kept under Overleaf's 60 s controller timeout — over
      // that the UI silently shows nothing), then MERGE the results (A+B):
      //   - both sides with matches → union of both match sets (real LT first;
      //     a span flagged by both becomes one match with combined
      //     replacements) — the client never sees just the faster tool's
      //     slice of findings;
      //   - LT with matches, LLM empty/failed → the LT response;
      //   - LT empty/unreachable, LLM ok    → the LLM response;
      //   - neither usable                → the LLM error (400/503/500)
      //     (the language gate lives on the LLM side, see runLlmCheck, so a
      //     non-English document is still served by the real LT).
      if (cfg.gtUrl) {
        const cascadeDeadline = Date.now() + cfg.cascadeBudgetMs;
        const t0 = Date.now();
        const [lt, llm] = await Promise.all([
          this.forwardToLanguagetool({
            cfg, body, params, bodyObj, language, level,
            deadline: cascadeDeadline,
          }),
          this.runLlmCheck({ cfg, language, level, fullText, runs: input.runs, cascadeDeadline }),
        ]);
        if (lt && llm.status === 200 && bodyHasMatches(llm.body)) {
          const merged = mergeLtAndLlm(lt, llm.body);
          this.log.info('merged real-LT + LLM matches', {
            gtUrl: cfg.gtUrl, level, ms: Date.now() - t0,
            lt: matchCount(lt), llm: matchCount(llm.body), served: matchCount(merged),
          });
          jsonOut(res, 200, merged, cfg.allowOrigin);
          return;
        }
        if (lt) {
          this.log.info('real LT produced matches; LLM had none (or failed) — serving LT', {
            gtUrl: cfg.gtUrl, level, ms: Date.now() - t0, matches: matchCount(lt),
          });
          jsonOut(res, 200, lt, cfg.allowOrigin);
          return;
        }
        if (llm.status === 200) {
          this.log.info('real LT found nothing (or was unreachable) — serving LLM result', {
            gtUrl: cfg.gtUrl, level, ms: Date.now() - t0, matches: matchCount(llm.body),
          });
          jsonOut(res, 200, llm.body, cfg.allowOrigin);
          return;
        }
        // Neither side produced a usable result — surface the LLM outcome
        // (e.g. 503 model not ready, or the language gate's 400).
        jsonOut(res, llm.status, llm.body ?? { message: 'no result' }, cfg.allowOrigin);
        return;
      }

      // 4) LLM-ONLY path (no real LT configured).
      const outcome = await this.runLlmCheck({ cfg, language, level, fullText, runs: input.runs, cascadeDeadline: null });
      if (outcome.status !== 200) {
        errorOut(res, outcome.status as 400 | 500 | 503, String((outcome.body as { message?: string })?.message ?? 'check failed'), cfg.allowOrigin);
        return;
      }
      jsonOut(res, 200, outcome.body, cfg.allowOrigin);
    } finally {
      this.inFlight--;
    }
  }

  /**
   * The LLM half of a check (language gate → engine → LT JSON). Resolves to a
   * full HTTP outcome, never throws (internal errors become 500 outcomes).
   */
  private async runLlmCheck(args: {
    cfg: Config;
    language: string;
    level: 'default' | 'picky';
    fullText: string;
    runs: TextRun[];
    /** shared cascade deadline (Date.now()+budget), or null for LLM-only. */
    cascadeDeadline: number | null;
  }): Promise<LlmOutcome> {
    const { cfg, language, level, fullText, runs, cascadeDeadline } = args;
    const { engine } = this.deps;

    // Language gate (LIVE ON THE LLM SIDE, not on the request): the model is
    // English-only, but a cascade front (real LT) can still serve other
    // languages for the same request — so an unsupported language only makes
    // the LLM half empty/400, it never suppresses the LT result.
    if (!isLanguageSupported(cfg, language)) {
      if (cfg.unsupportedLanguageMode === 'error') {
        return {
          status: 400,
          body: { message: `language not supported (this deployment runs the English grammar-llm model; got '${language}')` },
        };
      }
      this.log.info('unsupported language requested — LLM side returns empty matches', { language });
      return {
        status: 200,
        body: buildCheckResponse({ fullText: '', matches: [], sentenceRanges: [], languageCode: language, reportedVersion: cfg.reportedVersion }),
      };
    }

    try {
      await engine.ensureReady();
    } catch { /* surfaced via status() */ }
    const st = engine.status();
    if (st.state !== 'ready') {
      const hint = st.state === 'error'
        ? ` engine error: ${st.errorMessage ?? 'unknown'}`
        : ' (model still loading or downloading)';
      return { status: 503, body: { message: `grammar-llm engine not ready${hint}` } };
    }

    try {
      // The LLM gets the budget that is LEFT of the shared cascade window
      // (or its own default in LLM-only mode), so the total response time
      // stays under LT-client caps like Overleaf's 60 s.
      const budgetMs = cascadeDeadline
        ? Math.min(cfg.requestTimeoutMs, Math.max(1500, cascadeDeadline - Date.now()))
        : cfg.requestTimeoutMs;
      const { results, incomplete } = await engine.check(runs, {
        maxRuns: cfg.maxRuns,
        requestTimeoutMs: budgetMs,
        level,
      });

      const matches: LtMatch[] = [];
      const sentenceRanges: Array<[number, number]> = [];
      results.forEach((r, i) => {
        for (const s of r.suggestions) {
          matches.push(...suggestionToMatches(fullText, runs[i], s));
        }
        for (const s of splitIntoSentences(runs[i].text)) {
          sentenceRanges.push([runs[i].offset + s.start, runs[i].offset + s.end]);
        }
      });
      sentenceRanges.sort((a, b) => a[0] - b[0]);

      this.log.info('LLM check completed', {
        language, level, runs: results.length,
        matches: matches.length, incomplete,
        budgetMs,
      });

      const incompleteReason = incomplete
        ? 'Check stopped early: per-request time budget exhausted. Only a subset of the document was checked.'
        : undefined;

      return {
        status: 200,
        body: buildCheckResponse({
          fullText,
          matches,
          sentenceRanges,
          languageCode: language,
          incomplete: incompleteReason,
          reportedVersion: cfg.reportedVersion,
        }),
      };
    } catch (err) {
      this.log.error('LLM check failed', { err: String(err) });
      return { status: 500, body: { message: 'grammar-llm engine failed during check' } };
    }
  }
}

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel);
  const engine = new CheckEngine(cfg, log);
  const lt = new LtServer({ cfg, engine, log });

  if (cfg.preload) {
    if (cfg.backend === 'openai') {
      log.info('openai-compatible backend — no local model to preload', { baseUrl: cfg.openaiBaseUrl, model: cfg.openaiModel });
    } else {
      log.info('preloading model (first check waits for this to finish)…', { modelPath: cfg.modelPath });
    }
    engine.ensureReady().catch(() => {
      // surfaced via /v2/health and as 503s on /v2/check
    });
  }

  await lt.listen(cfg.port, cfg.host);
  const shutdown = (sig: string) => {
    log.info(`${sig} received, shutting down`);
    void lt.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Auto-start when executed directly (node dist/server.mjs); no-op when imported by tests.
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}
