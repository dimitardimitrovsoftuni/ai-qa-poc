// Local accounting for every model call: how many requests today, how many
// tokens, and what it cost (which should stay $0.0000 — that is the claim this
// POC makes, so it gets measured rather than asserted).
//
// The free tier allows 20 requests/minute and 50/day. Hitting that mid-suite
// leaves half-generated files behind, so a run refuses to start once the
// configured daily budget is spent.
//
// `calls` is the only thing stored. Per-day totals are derived from it on every
// read, and deliberately not persisted: an earlier version kept a running
// `days.failed` counter alongside the call log, the two drifted apart the moment
// the counter's definition changed, and the rollup was the one that read low.
// A denormalised total cannot be back-filled and nothing announces that it is
// stale — it just quietly reports a better number than the truth.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAiConfig, fromRoot } from './config.js';

export interface CallRecord {
  ts: string;
  role: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  ms: number;
  ok: boolean;
  /** Why it failed, when it did. A refused request still consumed an upstream
   *  attempt, so it belongs in the count. */
  error?: string;
}

export interface Totals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  /** Of those requests, how many came back with nothing usable. */
  failed: number;
}

interface UsageFile {
  calls: CallRecord[];
}

const empty: UsageFile = { calls: [] };

const usagePath = () => fromRoot(loadAiConfig().paths.usageFile);

/** Local calendar day — the OpenRouter cap resets daily, so local is close enough. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const dayOf = (call: CallRecord) => call.ts.slice(0, 10);

function read(): UsageFile {
  const file = usagePath();
  if (!existsSync(file)) return structuredClone(empty);
  try {
    // A legacy file also carries a `days` rollup. It is read and dropped:
    // whatever it says, the call log is what the totals now come from.
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<UsageFile>;
    return { calls: parsed.calls ?? [] };
  } catch {
    // A corrupt counter must never block a run; start a fresh one.
    return structuredClone(empty);
  }
}

function write(u: UsageFile): void {
  // Every call is kept. Trimming the tail would shrink the derived totals
  // without saying so, which is the failure this file exists to avoid; at a few
  // hundred bytes per call and 50 calls a day, the ledger stays small anyway.
  writeFileSync(usagePath(), `${JSON.stringify(u, null, 2)}\n`, 'utf8');
}

export function totalsOf(calls: CallRecord[]): Totals {
  return calls.reduce<Totals>(
    (acc, c) => ({
      requests: acc.requests + 1,
      promptTokens: acc.promptTokens + c.promptTokens,
      completionTokens: acc.completionTokens + c.completionTokens,
      cost: acc.cost + c.cost,
      failed: acc.failed + (c.ok ? 0 : 1),
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, failed: 0 },
  );
}

/** Per-day totals, oldest first, derived from the call log. */
export function byDay(calls: CallRecord[]): [string, Totals][] {
  const grouped = new Map<string, CallRecord[]>();
  for (const c of calls) {
    const day = dayOf(c);
    (grouped.get(day) ?? grouped.set(day, []).get(day)!).push(c);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayCalls]) => [day, totalsOf(dayCalls)]);
}

export function requestsToday(): number {
  const now = today();
  return read().calls.filter((c) => dayOf(c) === now).length;
}

export function remainingToday(): number {
  return Math.max(0, loadAiConfig().limits.dailyRequestBudget - requestsToday());
}

/** Throw before spending, so a run fails clean instead of half-done. */
export function assertBudget(needed = 1): void {
  const budget = loadAiConfig().limits.dailyRequestBudget;
  const left = remainingToday();
  if (left < needed) {
    throw new Error(
      `Daily request budget spent: ${requestsToday()}/${budget} used today, ${needed} needed. ` +
      `OpenRouter free tier allows 50/day (1000 after a one-time $10 credit purchase). ` +
      `Raise limits.dailyRequestBudget in config/ai.config.json, or continue tomorrow.`,
    );
  }
}

export function record(call: CallRecord): void {
  const u = read();
  u.calls.push(call);
  write(u);
}

export function summary() {
  const { calls } = read();
  return { days: byDay(calls), total: totalsOf(calls), calls };
}
