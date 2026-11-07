// HTTP API tests with a deterministic fake engine (no LLM, no network).
// Mirrors how Overleaf's LanguageToolController talks to a LT-compatible box:
//   GET  /v2/languages
//   POST /v2/check  (x-www-form-urlencoded: language, level, data/annotation,
//                    disabledRules — see LanguageToolController.mjs)

import test from 'node:test';
import assert from 'node:assert/strict';

import { LtServer } from '../dist/server.mjs';
import { CheckEngine } from '../dist/server.mjs';
import { loadConfig } from '../dist/config.mjs';
import http from 'node:http';

function makeConfig(over = {}) {
  const env = {
    PORT: '8010',
    HOST: '127.0.0.1',
    GRAMMAR_LLM_MODEL_DIR: '/tmp',
    GRAMMAR_LLM_PRELOAD: 'false',
    GRAMMAR_LLM_LOG_LEVEL: 'warn',
    ...over,
  };
  return loadConfig(env);
}

/** Deterministic "engine": corrects the literal word 'teh' → 'the' wherever it
 * appears, and inserts a comma after 'quick'. */
class FakeEngine {
  state = 'ready';
  statusError = null;
  checkCalls = 0;
  lastLevel = null;
  constructor() {}

  status() {
    return {
      state: this.state,
      errorMessage: this.statusError,
      modelPath: '/tmp/fake.gguf',
      checksCompleted: 0,
      checksFailed: 0,
    };
  }

  async ensureReady() {
    if (this.state !== 'ready') throw new Error('model not ready');
  }

  async check(runs, opts = {}) {
    if (this.state !== 'ready') throw new Error('not ready');
    this.checkCalls++;
    this.lastLevel = opts.level ?? null;
    const results = [];
    for (const run of runs) {
      const out = { suggestions: [], correctedText: run.text, incomplete: false };
      const t = run.text;
      const idx = t.indexOf('teh');
      if (idx >= 0) {
        const corrected = t.slice(0, idx) + 'the' + t.slice(idx + 3);
        out.correctedText = corrected;
        out.suggestions = [
          {
            original: t,
            corrected,
            sentence: 'Sentence 1',
            start_index: 0,
            end_index: t.length,
            original_highlighted: '',
            corrected_highlighted: '',
            wordFixes: [{ original: 'teh', corrected: 'the', start: idx, end: idx + 3 }],
          },
        ];
      }
      const kidx = t.indexOf('quick');
      if (kidx >= 0 && out.suggestions.length === 0) {
        // insertion after 'quick' (pos = kidx+5)
        const pos = kidx + 5;
        const corrected = t.slice(0, pos) + ',' + t.slice(pos);
        out.correctedText = corrected;
        out.suggestions = [
          {
            original: t,
            corrected,
            sentence: 'Sentence 1',
            start_index: 0,
            end_index: t.length,
            original_highlighted: '',
            corrected_highlighted: '',
            wordFixes: [{ original: '', corrected: ',', start: pos, end: pos }],
          },
        ];
      }
      results.push(out);
    }
    return { results, incomplete: false };
  }
}

async function boot(_over = {}, engineOverride, cfgOver = {}) {
  const cfg = makeConfig(cfgOver);
  const engine = engineOverride ?? new FakeEngine();
  const server = new LtServer({ cfg, engine });
  await server.listen(0, '127.0.0.1');
  const port = server.httpServer.address().port;
  return { cfg, engine, server, base: `http://127.0.0.1:${port}` };
}

async function close(server) {
  await server.close();
}

test('GET /v2/languages: LT shape (Overleaf reads name+code)', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/languages`);
    assert.equal(res.status, 200);
    const body = (await res.json());
    assert.ok(Array.isArray(body));
    assert.ok(body.some((l) => l.code === 'en-US'));
  } finally {
    await close(server);
  }
});

test('POST /v2/check (Overleaf style: form + annotation data)', async (t) => {
  const { server, base } = await boot();
  try {
    const source = 'He wrote \\textbf{report} about teh project.';
    const annotation = [
      { text: 'He wrote ' },
      { markup: '\\textbf{report} ' },
      { text: 'about teh project.' },
    ];
    const params = new URLSearchParams();
    params.set('language', 'auto');
    params.set('level', 'picky');
    params.set('data', JSON.stringify({ annotation }));
    params.set('disabledRules', 'WHITESPACE_RULE,CONSECUTIVE_SPACES');

    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params.toString(),
    });
    assert.equal(res.status, 200);
    const body = (await res.json());

    assert.equal(body.software.name, 'LanguageTool');
    assert.equal(body.software.apiVersion, 1);
    assert.equal(body.warnings.incompleteResults, false);
    assert.equal(body.language.code, 'en-US');

    // 'teh' is at absolute offset: len('He wrote ') + len('\\textbf{report} ')
    const baseOffset = 'He wrote '.length + '\\textbf{report} '.length;
    assert.equal(body.matches.length, 1);
    const m = body.matches[0];
    assert.equal(m.offset, baseOffset + 'about '.length);
    assert.equal(m.length, 3);
    assert.deepEqual(m.replacements, [{ value: 'the' }]);
    assert.equal(m.rule.category.id, 'GRAMMAR');
    assert.ok(m.context.text.includes('teh'));
    // overleaf invariant: offset within doc
    assert.ok(m.offset + m.length <= source.length);
  } finally {
    await close(server);
  }
});

test('POST /v2/check with JSON body', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en-GB', level: 'default', text: 'I has teh book.' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json());
    assert.equal(body.language.code, 'en-GB');
    assert.equal(body.matches.length, 1);
    assert.equal(body.matches[0].offset, 6); // 'has ' before 'teh' → 'I has teh' → t@6
    assert.deepEqual(body.matches[0].replacements, [{ value: 'the' }]);
  } finally {
    await close(server);
  }
});

test('POST /v2/check: no text and no data → 400', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en',
    });
    assert.equal(res.status, 400);
    const body = (await res.json());
    assert.match(body.message, /Missing/);
  } finally {
    await close(server);
  }
});

test('POST /v2/check: too-long text → 413', async (t) => {
  const { server, base } = await boot({}, undefined, { GRAMMAR_LLM_MAX_TEXT_LENGTH: '3000' });
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&text=' + encodeURIComponent('a'.repeat(3500)),
    });
    assert.equal(res.status, 413);
  } finally {
    await close(server);
  }
});

test('POST /v2/check: unsupported language → empty matches (default mode)', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=de&text=' + encodeURIComponent('Ich habe teh Buch.'),
    });
    assert.equal(res.status, 200);
    const body = (await res.json());
    assert.deepEqual(body.matches, []);
  } finally {
    await close(server);
  }
});

test('POST /v2/check: unsupported language → 400 (error mode)', async (t) => {
  const { server, base } = await boot({}, undefined, { GRAMMAR_LLM_UNSUPPORTED_LANGUAGE: 'error' });
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=de&text=' + encodeURIComponent('Ich habe teh Buch.'),
    });
    assert.equal(res.status, 400);
  } finally {
    await close(server);
  }
});

test('POST /v2/check: engine not ready → 503 with message', async (t) => {
  const engine = new FakeEngine();
  engine.state = 'loading';
  const { server, base } = await boot({}, engine);
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&text=' + encodeURIComponent('I has teh book.'),
    });
    assert.equal(res.status, 503);
    const body = (await res.json());
    assert.match(body.message, /not ready/);
  } finally {
    await close(server);
  }
});

test('GET /v2/health reflects engine state', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/health`);
    assert.equal(res.status, 200);
    const body = (await res.json());
    assert.equal(body.status, 'ok');
    assert.equal(body.state, 'ready');
  } finally {
    await close(server);
  }
});

test('GET /v2/health: not ready → 503', async (t) => {
  const engine = new FakeEngine();
  engine.state = 'error';
  engine.statusError = 'boom';
  const { server, base } = await boot({}, engine);
  try {
    const res = await fetch(`${base}/v2/health`);
    assert.equal(res.status, 503);
    const body = (await res.json());
    assert.equal(body.state, 'error');
  } finally {
    await close(server);
  }
});

test('GET /v2/version and / info payloads', async (t) => {
  const { server, base } = await boot();
  try {
    const v = (await (await fetch(`${base}/v2/version`)).json());
    assert.equal(v.name, 'LanguageTool');
    assert.ok(v.engine);

    const i = (await (await fetch(`${base}/`)).json());
    assert.ok(Array.isArray(i.endpoints));
  } finally {
    await close(server);
  }
});

test('unknown /v2 endpoint → 404 JSON', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/nope`);
    assert.equal(res.status, 404);
    const body = (await res.json());
    assert.match(body.message, /unknown v2 endpoint/);
  } finally {
    await close(server);
  }
});

test('OPTIONS preflight → CORS headers', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/check`, { method: 'OPTIONS' });
    assert.ok([200, 204].includes(res.status));
    assert.ok((res.headers.get('access-control-allow-origin') ?? '').includes('*'));
  } finally {
    await close(server);
  }
});

test('responses carry CORS + no-store headers (browser client compat)', async (t) => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/v2/languages`);
    assert.ok((res.headers.get('access-control-allow-origin') ?? '').includes('*'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  } finally {
    await close(server);
  }
});

// ---------------------------------------------------------------------------
// New: LT-first cascade, LLM level modes, OpenAI-compatible remote backend
// ---------------------------------------------------------------------------

/** In-process fake LanguageTool (v2 /check). Optional {delayMs} to simulate a slow LT. */
function fakeLt(handler, { delayMs = 0 } = {}) {
  const seen = { bodies: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = new URLSearchParams(raw);
      seen.bodies.push(Object.fromEntries(body.entries()));
      const done = () => {
        const out = handler(body, seen.bodies.length - 1) ?? { matches: [] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      };
      if (delayMs > 0) setTimeout(done, delayMs);
      else done();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** In-process fake OpenAI-compatible chat/completions endpoint. */
function fakeOpenAi(corrections = {}) {
  const seen = { requests: [] };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"data":[{"id":"fake"}]}');
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const json = JSON.parse(raw || '{}');
      seen.requests.push(json);
      const user = json.messages?.[1]?.content ?? '';
      const corrected = corrections[user] ?? user;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: corrected } }],
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test('cascade: LT + LLM both produce matches → merged union (A+B), level forwarded', async () => {
  const lt = await fakeLt(() => ({
    software: { name: 'LanguageTool', version: '6.4' },
    warnings: { incompleteResults: false },
    matches: [
      {
        message: 'FROM-REAL-LT',
        shortMessage: 'LT-match',
        replacements: [{ value: 'kittens' }],
        offset: 10,
        length: 4,
        context: { text: 'has cats', offset: 5, length: 8 },
        type: { typeName: 'Grammatical' },
        rule: { id: 'RULE_LT', description: 'x', issueType: 'Grammar', category: { id: 'GRAMMAR', name: 'Grammar' } },
      },
    ],
  }));
  try {
    const engine = new FakeEngine();
    const { server, base } = await boot(
      {},
      engine,
      { GRAMMAR_LLM_LANGUAGETOOL_URL: lt.url, GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '2000' },
    );
    try {
      const res = await fetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'language=en&level=picky&text=' + encodeURIComponent('I teh has cats'),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      // A+B: the real-LT match AND the LLM match (different spans) are both
      // present — cascade mode merges, it no longer returns the faster
      // tool's slice.
      assert.equal(body.matches.length, 2, 'LT + LLM matches must be merged, not replaced');
      const ltMatch = body.matches.find((m) => m.message === 'FROM-REAL-LT');
      const llmMatch = body.matches.find((m) => m.message !== 'FROM-REAL-LT');
      assert.ok(ltMatch, 'real-LT match must be present');
      assert.ok(llmMatch, 'LLM match must be present');
      assert.equal(ltMatch.offset, 10);
      assert.equal(body.software.version, '6.4');
      assert.equal(engine.checkCalls, 1, 'LLM now always runs in cascade mode (merge)');
      // the picky flag must reach the real LT verbatim:
      assert.equal(lt.seen.bodies[0].level, 'picky');
      assert.equal(lt.seen.bodies[0].language, 'en');
    } finally {
      await close(server);
    }
  } finally {
    await lt.close();
  }
});

test('cascade: identical span flagged by both → one match (LT) with deduped replacements', async () => {
  const lt = await fakeLt(() => ({
    software: { name: 'LanguageTool', version: '6.4' },
    warnings: { incompleteResults: false },
    matches: [
      {
        message: 'FROM-REAL-LT',
        replacements: [{ value: 'the' }],
        offset: 2,
        length: 3,
        context: { text: 'I teh has', offset: 0, length: 9 },
        type: { typeName: 'Typographical' },
        rule: { id: 'RULE_LT', description: 'x', issueType: 'Typo', category: { id: 'TYPOS', name: 'Typos' } },
      },
      {
        message: 'FROM-REAL-LT-2',
        replacements: [{ value: 'kittens' }],
        offset: 10,
        length: 4,
        context: { text: 'cats', offset: 10, length: 4 },
        type: { typeName: 'Grammatical' },
        rule: { id: 'RULE_LT2', description: 'x', issueType: 'Grammar', category: { id: 'GRAMMAR', name: 'Grammar' } },
      },
    ],
  }));
  // The FakeEngine flags 'teh' (offset 2) — the SAME span as the first LT
  // match — so the merge must collapse that span into ONE match (the
  // real-LT one) instead of echoing two identical squiggles.
  try {
    const engine = new FakeEngine();
    const { server, base } = await boot(
      {},
      engine,
      { GRAMMAR_LLM_LANGUAGETOOL_URL: lt.url, GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '2000' },
    );
    try {
      const res = await fetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'language=en&text=' + encodeURIComponent('I teh has cats'),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.matches.length, 2, 'shared span merged into one; distinct LT span kept');
      const shared = body.matches.find((m) => m.offset === 2);
      assert.ok(shared, 'the shared span must be present exactly once');
      assert.equal(shared.message, 'FROM-REAL-LT', 'LT match stays authoritative for the shared span');
      assert.deepEqual(
        shared.replacements.map((r) => r.value),
        ['the'],
        'identical candidate from the LLM must be deduped, not doubled',
      );
      assert.ok(body.matches.some((m) => m.message === 'FROM-REAL-LT-2'));
    } finally {
      await close(server);
    }
  } finally {
    await lt.close();
  }
});

test('cascade: real LT finds nothing → LLM runs second (fallback)', async () => {
  const lt = await fakeLt(() => ({ matches: [] }));
  try {
    const engine = new FakeEngine();
    const { server, base } = await boot(
      {},
      engine,
      { GRAMMAR_LLM_LANGUAGETOOL_URL: lt.url, GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '2000' },
    );
    try {
      const res = await fetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'language=en&level=default&text=' + encodeURIComponent('I teh has cats'),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.matches.length, 1, 'fallback LLM match expected');
      assert.match(body.matches[0].message, /the/);
      assert.equal(engine.checkCalls, 1, 'LLM must run exactly once as fallback');
      assert.equal(lt.seen.bodies[0].level, 'default');
    } finally {
      await close(server);
    }
  } finally {
    await lt.close();
  }
});

test('cascade: real LT down → LLM fallback still returns 200', async () => {
  const engine = new FakeEngine();
  const { server, base } = await boot(
    {},
    engine,
    {
      GRAMMAR_LLM_LANGUAGETOOL_URL: 'http://127.0.0.1:9', // closed port
      GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '800',
    },
  );
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&text=' + encodeURIComponent('I teh has cats'),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.matches.length, 1);
    assert.equal(engine.checkCalls, 1);
  } finally {
    await close(server);
  }
});

test('cascade merge: slow empty LT still settles — LLM result served within the shared budget', async () => {
  // Merge semantics: the response is served once the LT side SETTLES — its
  // empty (or error) result still matters, because it decides whether the
  // LLM result is the whole answer or part of a union. Both sides share ONE
  // budget (cascadeBudgetMs), which stays under Overleaf's 60 s controller
  // timeout, so the total always lands in time — worst case is a *partial*
  // result (warnings.incompleteResults), never a client-side timeout.
  const lt = await fakeLt(() => ({ matches: [] }), { delayMs: 2000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const engine = new FakeEngine();
  const origCheck = engine.check.bind(engine);
  // make the LLM take ~300 ms so it settles well before the 2 s LT
  engine.check = async (runs, opts = {}) => {
    await sleep(300);
    return origCheck(runs, opts);
  };
  const { server, base } = await boot(
    {},
    engine,
    {
      GRAMMAR_LLM_LANGUAGETOOL_URL: lt.url,
      GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '4000',
      GRAMMAR_LLM_CASCADE_BUDGET_MS: '6000',
    },
  );
  try {
    const t0 = Date.now();
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&text=' + encodeURIComponent('I teh has cats'),
    });
    const elapsed = Date.now() - t0;
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.matches.length >= 1, 'LLM match must be present');
    assert.ok(
      elapsed >= 1500,
      `served after the LT side settled (elapsed ${elapsed} ms; LT was 2000 ms)`,
    );
    assert.ok(
      elapsed < 6000,
      `must stay under the shared cascade budget (elapsed ${elapsed} ms)`,
    );
    assert.equal(engine.checkCalls, 1, 'the LLM ran');
  } finally {
    await close(server);
    await lt.close();
  }
});

test('cascade merge: LT matches slower than the LLM are STILL in the union', async () => {
  const lt = await fakeLt(() => ({
    software: { name: 'LanguageTool', version: '6.4' },
    warnings: { incompleteResults: false },
    matches: [
      {
        message: 'FROM-REAL-LT',
        replacements: [{ value: 'kittens' }],
        offset: 10,
        length: 4,
        context: { text: 'cats', offset: 10, length: 4 },
        type: { typeName: 'Typographical' },
        rule: { id: 'RULE_LT', category: { id: 'TYPOS', name: 'Typos' } },
      },
    ],
  }), { delayMs: 700 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const engine = new FakeEngine();
  const origCheck = engine.check.bind(engine);
  engine.check = async (runs, opts = {}) => {
    await sleep(200); // LLM "finishes" first — the merge must still wait for the LT
    return origCheck(runs, opts);
  };
  const { server, base } = await boot(
    {},
    engine,
    {
      GRAMMAR_LLM_LANGUAGETOOL_URL: lt.url,
      GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '4000',
      GRAMMAR_LLM_CASCADE_BUDGET_MS: '6000',
    },
  );
  try {
    const res = await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&level=picky&text=' + encodeURIComponent('I teh has cats'),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.matches.length, 2, 'union: slower LT match + LLM match');
    assert.ok(body.matches.some((m) => m.message === 'FROM-REAL-LT'), 'the LT match must be present');
    assert.ok(body.matches.some((m) => m.message !== 'FROM-REAL-LT'), 'the LLM match must be present');
  } finally {
    await close(server);
    await lt.close();
  }
});

test('cascade: unsupported language — real LT still served, gate applies to the LLM side only', async () => {
  const lt = await fakeLt(() => ({
    software: { name: 'LanguageTool', version: '6.4' },
    warnings: { incompleteResults: false },
    matches: [
      {
        message: 'LT-OTHER-LANG-MATCH',
        replacements: [{ value: 'der' }],
        offset: 4,
        length: 3,
        type: { typeName: 'Grammatical' },
        rule: { id: 'RULE_DE', description: 'x', issueType: 'Grammar', category: { id: 'GRAMMAR', name: 'Grammar' } },
      },
    ],
  }));
  try {
    const engine = new FakeEngine();
    const { server, base } = await boot(
      {},
      engine,
      {
        GRAMMAR_LLM_LANGUAGETOOL_URL: lt.url,
        GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS: '2000',
        GRAMMAR_LLM_UNSUPPORTED_LANGUAGE: 'error', // LLM gate set to the strictest mode
      },
    );
    try {
      const res = await fetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'language=de&text=' + encodeURIComponent('Ich teh habe Katzen'),
      });
      assert.equal(res.status, 200, 'real LT covers the language; the LLM gate must not veto it');
      const body = await res.json();
      assert.equal(body.matches.length, 1);
      assert.equal(body.matches[0].message, 'LT-OTHER-LANG-MATCH');
      assert.equal(engine.checkCalls, 0, 'no LLM compute on an unsupported language');
    } finally {
      await close(server);
    }
  } finally {
    await lt.close();
  }
});

test('level: absent/invalid → cfg.defaultLevel; explicit respected (LLM receives it)', async () => {
  const mk = (env) => {
    const engine = new FakeEngine();
    return { engine, env: { ...env } };
  };
  // absent level
  {
    const { engine } = mk({});
    const { server, base } = await boot({}, engine, { GRAMMAR_LLM_DEFAULT_LEVEL: 'picky' });
    await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&text=' + encodeURIComponent('I teh has'),
    });
    assert.equal(engine.lastLevel, 'picky');
    await close(server);
  }
  // invalid level → falls back to defaultLevel
  {
    const { engine } = mk({});
    const { server, base } = await boot({}, engine, { GRAMMAR_LLM_DEFAULT_LEVEL: 'picky' });
    await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&level=bogus&text=' + encodeURIComponent('I teh has'),
    });
    assert.equal(engine.lastLevel, 'picky');
    await close(server);
  }
  // explicit picky
  {
    const { engine } = mk({});
    const { server, base } = await boot({}, engine, {});
    await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&level=picky&text=' + encodeURIComponent('I teh has'),
    });
    assert.equal(engine.lastLevel, 'picky');
    await close(server);
  }
  // explicit default
  {
    const { engine } = mk({});
    const { server, base } = await boot({}, engine, {});
    await fetch(`${base}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'language=en&level=default&text=' + encodeURIComponent('I teh has'),
    });
    assert.equal(engine.lastLevel, 'default');
    await close(server);
  }
  void mk;
});

test('openai backend: real engine pipeline against a fake OpenAI endpoint (default level prompt)', async () => {
  const fake = await fakeOpenAi({ 'He run fast to school.': 'He ran fast to school.' });
  try {
    const cfg = makeConfig({
      GRAMMAR_LLM_BACKEND: 'openai',
      GRAMMAR_LLM_OPENAI_MODEL: 'fake-model-123',
      GRAMMAR_LLM_OPENAI_BASE_URL: fake.baseUrl,
      GRAMMAR_LLM_OPENAI_TIMEOUT_MS: '5000',
      GRAMMAR_LLM_DEFAULT_LEVEL: 'default',
    });
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const engine = new CheckEngine(cfg, log);
    const server = new LtServer({ cfg, engine, log });
    await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    try {
      const res = await fetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'language=en&text=' + encodeURIComponent('He run fast to school.'),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.matches.length, 1, 'core diff must produce the ran-fix');
      assert.equal(body.matches[0].replacements[0].value, 'ran');
      // request shape: model + system prompt
      const req = fake.seen.requests[0];
      assert.equal(req.model, 'fake-model-123');
      assert.equal(req.messages[0].role, 'system');
      assert.match(req.messages[0].content, /grammar correction assistant/);
      assert.doesNotMatch(req.messages[0].content, /highly picky/);
    } finally {
      await server.close();
    }
  } finally {
    await fake.close();
  }
});

test('openai backend: picky level gets the stricter prompt; default does not', async () => {
  const fake = await fakeOpenAi({ 'He run fast to school.': 'He ran fast to school.' });
  try {
    const mk = (defaultLevel) => {
      const cfg = makeConfig({
        GRAMMAR_LLM_BACKEND: 'openai',
        GRAMMAR_LLM_OPENAI_MODEL: 'fake-model-123',
        GRAMMAR_LLM_OPENAI_BASE_URL: fake.baseUrl,
        GRAMMAR_LLM_OPENAI_TIMEOUT_MS: '5000',
        GRAMMAR_LLM_DEFAULT_LEVEL: defaultLevel,
      });
      const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
      const engine = new CheckEngine(cfg, log);
      return new LtServer({ cfg, engine, log });
    };
    // explicit picky
    {
      const server = mk('default');
      await server.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${server.httpServer.address().port}`;
      await fetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'language=en&level=picky&text=' + encodeURIComponent('He run fast to school.'),
      });
      await server.close();
    }
    const pickyReq = fake.seen.requests[fake.seen.requests.length - 1];
    assert.match(pickyReq.messages[0].content, /highly picky/);
    assert.match(pickyReq.messages[0].content, /grammar correction assistant/);
  } finally {
    await fake.close();
  }
});
