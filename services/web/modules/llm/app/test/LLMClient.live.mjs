#!/usr/bin/env node
/* eslint-disable no-console -- diagnostic CLI; console is its purpose */
import { z } from 'zod';
import Client from '../src/LLMClient.mjs';

const spec = Client.normalizeProviderSpec(
  { providerType: 'openaiCompatible', baseUrl: 'http://172.18.0.1:11434/v1', apiKey: 'ollama' },
  { model: 'qwen3.8:latest' }
);
console.log('spec:', JSON.stringify(spec));

const t0 = Date.now();
const r = await Client.chatText(
  spec,
  [{ role: 'user', content: 'Reply with exactly one word: HELLO' }],
  { maxOutputTokens: 200, temperature: 0 }
);
console.log('chatText:', JSON.stringify(r), `${Date.now() - t0}ms`);

const l = await Client.listModels(spec);
console.log('listModels:', l.ids.join(', '));

try {
  await Client.chatText(
    { ...spec, model: 'no-such-model-xyz' },
    [{ role: 'user', content: 'hi' }],
    { maxOutputTokens: 8, timeoutMs: 15000 }
  );
  console.log('bad-model: NO ERROR (unexpected)');
}
catch (e) { console.log('bad-model -> code:', e.code, '| msg:', e.message.slice(0, 120)); }

const o = await Client.chatObject(
  spec,
  [{ role: 'user', content: 'Give me exactly two short review items about LaTeX spacing' }],
  z.object({ items: z.array(z.object({ item: z.string(), severity: z.enum(['info', 'error']) }), { min: 2, max: 2 }) }),
  { maxOutputTokens: 600 }
);
console.log('chatObject:', JSON.stringify(o.object).slice(0, 220), '| usage:', JSON.stringify(o.usage));
