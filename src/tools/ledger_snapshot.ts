// Freezes the local ledger into docs/ so the cost claim can be checked by
// someone who will never run this project.
//
//   npm run ledger
//
// usage.json itself stays out of git: it changes on every call, and a file that
// churns on every run is one nobody reads. The snapshot is the same data,
// committed at a point in time, with the totals derived rather than restated.
//
// Nothing here is stamped with the time of generation — the reporting period
// comes from the first and last call in the log. Regenerating an unchanged
// ledger therefore produces a byte-identical file instead of a diff that says
// only that the command was run again.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromRoot } from '../lib/config.js';
import { summary, totalsOf, type CallRecord, type Totals } from '../lib/usage.js';
import { step, ok, warn, info, bold, dim } from '../lib/log.js';

const JSON_OUT = fromRoot('docs', 'cost-ledger.json');
const MD_OUT = fromRoot('docs', 'cost-ledger.md');

const { days, total, calls } = summary();

if (!calls.length) {
  warn('no model calls recorded yet — nothing to snapshot');
  process.exit(0);
}

/** Group calls by an arbitrary key, ordered by request count, ties broken by name. */
function group(by: (c: CallRecord) => string): [string, Totals][] {
  const grouped = new Map<string, CallRecord[]>();
  for (const c of calls) {
    const key = by(c);
    (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(c);
  }
  return [...grouped.entries()]
    .map(([key, cs]) => [key, totalsOf(cs)] as [string, Totals])
    .sort((a, b) => b[1].requests - a[1].requests || a[0].localeCompare(b[0]));
}

const byModel = group((c) => c.model);
const byRole = group((c) => c.role);
const period = { from: calls[0]!.ts, to: calls[calls.length - 1]!.ts };

mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      note: 'Snapshot of the local ledger. Totals are derived from `calls`, which is the only source of truth.',
      source: 'usage.json',
      period,
      total,
      days: Object.fromEntries(days),
      byModel: Object.fromEntries(byModel),
      byRole: Object.fromEntries(byRole),
      calls,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const pct = (n: number) => `${((n / total.requests) * 100).toFixed(1)}%`;
const row = (label: string, t: Totals) =>
  `| ${label} | ${t.requests} | ${t.failed} | ${t.promptTokens.toLocaleString('en-US')} | ` +
  `${t.completionTokens.toLocaleString('en-US')} | $${t.cost.toFixed(4)} |`;

const md = `# Cost ledger

Every model call this project has made, as recorded at the time it was made.
Regenerate with \`npm run ledger\`; the working file is \`usage.json\`, which is
not committed because it changes on every run.

The per-day and per-model totals below are **derived from the call log on every
read**, not stored alongside it. An earlier version of this ledger did keep a
separate running counter of failures, the counter's definition changed halfway
through 21 August, and the five failures already recorded before that point were
never back-filled — so the rollup read 18 where the call log said 23. A total
that cannot be recomputed cannot be corrected, and it fails in the flattering
direction.

## Headline

| | |
|---|---|
| Requests | **${total.requests}** over ${days.length} days (${period.from.slice(0, 10)} → ${period.to.slice(0, 10)}) |
| Failed | ${total.failed} (${pct(total.failed)}) — refused, rate-limited or timed out |
| Tokens in / out | ${total.promptTokens.toLocaleString('en-US')} / ${total.completionTokens.toLocaleString('en-US')} |
| Distinct model ids | ${byModel.length} |
| **Total spend** | **$${total.cost.toFixed(4)}** |

Failed requests are counted. They consumed an upstream attempt whether or not
they returned anything usable.

## By day

| Date | Sent | Failed | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|---:|
${days.map(([day, t]) => row(day, t)).join('\n')}
${row('**Total**', total)}

## By model

| Model | Sent | Failed | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|---:|
${byModel.map(([model, t]) => row(`\`${model}\``, t)).join('\n')}

\`openrouter/free\` is not a model — it is the auto-router, asked for whatever is
serving at that moment. It is listed here because it was requested that way, and
its failure rate is the reason the pipeline pins a model id instead.

## By role

| Role | Sent | Failed | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|---:|
${byRole.map(([role, t]) => row(role, t)).join('\n')}
`;

writeFileSync(MD_OUT, md, 'utf8');

step(bold('Ledger snapshot'));
info(dim(`${total.requests} calls, ${total.failed} failed, ${byModel.length} model ids, $${total.cost.toFixed(4)}`));
ok(`docs/cost-ledger.json`);
ok(`docs/cost-ledger.md`);
