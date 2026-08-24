// Which free endpoints are actually serving, right now?
//
//   npm run probe                 # the models this project is configured to use
//   npm run probe -- --all        # a wider list of free coding-capable models
//
// Free-tier availability swings by hour and by model: on one morning a 550B model
// answered a 14.4k-character prompt in 60 seconds, and by afternoon the same
// endpoint would not serve 13.1k at all while small models answered instantly.
// Guessing which one is up costs minutes per attempt; asking costs one tiny
// request each and turns the question into data.

import { loadAiConfig } from '../lib/config.js';
import { complete } from '../ai/openrouter.js';
import { remainingToday } from '../lib/usage.js';
import { ok, fail, warn, info, step, bold, dim } from '../lib/log.js';

const WIDER = [
  'poolside/laguna-s-2.1:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'openai/gpt-oss-20b:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free',
];

const cfg = loadAiConfig();
const configured = [...new Set(
  Object.values(cfg.roles).flatMap(r => [r.model, ...r.fallbacks]),
)];
const models = process.argv.includes('--all') ? WIDER : configured;

step(`Probing ${bold(String(models.length))} model(s) ${dim(`— ${remainingToday()} request(s) left in today's budget`)}`);
info(dim('one tiny request each; a slow reply here means a slow reply for real work'));
console.log();

const results: { model: string; ms: number; note: string }[] = [];

for (const model of models) {
  if (remainingToday() < 2) {
    warn('stopping — the daily budget is nearly spent');
    break;
  }
  const started = Date.now();
  try {
    // 60s is generous for four tokens. Anything slower is not worth using today.
    const res = await complete({
      model,
      system: 'Answer with one word.',
      prompt: 'Reply with the single word: ready',
      maxOutputTokens: 16,
      temperature: 0,
      label: 'probe',
      role: 'ping',
    });
    const ms = Date.now() - started;
    results.push({ model, ms, note: res.text.trim().slice(0, 20) });
    ok(`${model.padEnd(42)} ${String(ms).padStart(6)}ms  ${dim(res.text.trim().slice(0, 20))}`);
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const short = /429/.test(msg) ? 'rate-limited upstream'
      : /abort|timeout/i.test(msg) ? 'timed out'
      : msg.slice(0, 60);
    results.push({ model, ms, note: `FAILED: ${short}` });
    fail(`${model.padEnd(42)} ${String(ms).padStart(6)}ms  ${short}`);
  }
}

const alive = results.filter(r => !r.note.startsWith('FAILED')).sort((a, b) => a.ms - b.ms);
console.log();
if (!alive.length) {
  fail(bold('nothing is serving right now — try again later rather than burning the budget'));
  process.exit(1);
}
step(bold('Serving now, fastest first'));
for (const r of alive) console.log(`  ${String(r.ms).padStart(6)}ms  ${r.model}`);
console.log();
info('Point a role at one of these in config/ai.config.json, or put it first in that role\'s fallbacks.');
