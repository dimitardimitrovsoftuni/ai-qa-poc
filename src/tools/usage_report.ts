// What the pipeline has actually consumed. The headline number of this POC is a
// cost, so it gets reported from a ledger rather than asserted in a README.
//
//   npm run usage
//   npm run usage -- --calls        # per-call detail

import { loadAiConfig } from '../lib/config.js';
import { summary, requestsToday, remainingToday, today } from '../lib/usage.js';
import { step, ok, warn, info, bold, dim } from '../lib/log.js';

const showCalls = process.argv.slice(2).includes('--calls');
const cfg = loadAiConfig();
const s = summary();

if (!s.total.requests) {
  warn('no model calls recorded yet — run npm run ai:ping');
  process.exit(0);
}

step(bold('Model usage'));
console.log(`  ${'date'.padEnd(12)}${'sent'.padStart(7)}${'failed'.padStart(8)}${'in'.padStart(10)}${'out'.padStart(9)}${'cost'.padStart(10)}`);
for (const [day, d] of s.days) {
  console.log(
    `  ${day.padEnd(12)}${String(d.requests).padStart(7)}${String(d.failed ?? 0).padStart(8)}` +
    `${String(d.promptTokens).padStart(10)}${String(d.completionTokens).padStart(9)}` +
    `${`$${d.cost.toFixed(4)}`.padStart(10)}`,
  );
}
console.log(
  `  ${bold('total'.padEnd(12))}${bold(String(s.total.requests).padStart(7))}${String(s.total.failed).padStart(8)}` +
  `${String(s.total.promptTokens).padStart(10)}${String(s.total.completionTokens).padStart(9)}` +
  `${bold(`$${s.total.cost.toFixed(4)}`.padStart(10))}`,
);
if (s.total.failed) {
  info(dim(`${s.total.failed} of ${s.total.requests} request(s) came back with nothing — refused, rate-limited or timed out`));
}

const byModel = new Map<string, number>();
for (const c of s.calls) byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1);
console.log();
step(bold('By model'));
for (const [model, count] of [...byModel].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}  ${model}`);
}

if (showCalls) {
  console.log();
  step(bold('Calls'));
  for (const c of s.calls.slice(-40)) {
    console.log(
      `  ${c.ts.slice(0, 19).replace('T', ' ')}  ${c.role.padEnd(10)}` +
      `${String(c.promptTokens).padStart(7)} in ${String(c.completionTokens).padStart(6)} out  ` +
      `${(c.ms / 1000).toFixed(1)}s  ${c.ok ? '' : 'EMPTY '}${c.model}`,
    );
  }
}

console.log();
info(`today (${today()}): ${requestsToday()}/${cfg.limits.dailyRequestBudget} of the configured budget used, ${remainingToday()} left`);
info(dim('free tier: 20 requests/minute, 50/day (1000/day after a one-time $10 credit purchase)'));

if (s.total.cost === 0) ok(bold('total spend: $0.00 — every call served by a free model'));
else warn(`total spend: $${s.total.cost.toFixed(4)} — a paid model was used at some point`);
