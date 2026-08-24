// Smallest possible end-to-end check of the AI path: one cheap call, then the
// ledger. Run it before blaming the planner for anything.
//
//   npm run ai:ping
//   npm run ai:ping -- --role generator

import { askModel } from '../ai/client.js';
import { requestsToday, remainingToday, summary } from '../lib/usage.js';
import { loadAiConfig } from '../lib/config.js';
import { ok, fail, info, step, bold, dim } from '../lib/log.js';

const argv = process.argv.slice(2);
const roleArg = argv.indexOf('--role');
const role = roleArg >= 0 ? argv[roleArg + 1]! : 'ping';

const cfg = loadAiConfig();
step(`Pinging role ${bold(role)} — budget ${requestsToday()}/${cfg.limits.dailyRequestBudget} used today`);

try {
  const res = await askModel({
    role,
    system: 'You are a terse assistant. Answer in exactly one short sentence, no preamble.',
    prompt: 'Name the three stages of an automated UI test: arrange, act, and what?',
    label: 'ai-ping',
    maxOutputTokens: 64,
  });

  ok(`reply from ${bold(res.model)}${res.usedFallback ? ' (via fallback)' : ''}`);
  console.log(`  ${res.text.trim().slice(0, 300)}`);

  const s = summary();
  info(`ledger: ${s.total.requests} request(s) all-time, ` +
    `${s.total.promptTokens} in / ${s.total.completionTokens} out tokens, ` +
    `$${s.total.cost.toFixed(4)} total`);
  info(dim(`${remainingToday()} request(s) left in today's budget`));

  if (s.total.cost > 0) {
    console.log();
    fail(`This run was not free ($${s.total.cost.toFixed(4)}). Check config/ai.config.json — a paid model slipped in.`);
    process.exit(1);
  }
  ok(bold('AI path works, at zero cost'));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
