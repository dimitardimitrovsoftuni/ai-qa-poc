// Plan and generate several features in one go, then report what landed.
//
//   npm run batch -- --file batches/<name>.json [--dry-run]
//
// Written after doing this by hand a dozen times. It exists mainly to be careful
// with the two things that bite on a free tier: it checks the daily request
// budget BEFORE starting each feature, and it stops the whole batch the moment
// the budget would not cover another one — a half-generated feature is worse than
// a missing one. Failures are reported, not fatal: one feature the endpoint
// refuses should not throw away the ones that worked.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fromRoot } from '../lib/config.js';
import { remainingToday, requestsToday } from '../lib/usage.js';
import { step, ok, warn, fail, info, die, bold, dim, cyan } from '../lib/log.js';

const tsx = fromRoot('node_modules', 'tsx', 'dist', 'cli.mjs');

interface Job {
  site: string;
  feature: string;
  pages?: string;
  maxTests?: number;
  notes?: string;
  /** Skip planning and use this plan file as-is. */
  plan?: string;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get('--file');
  if (!file) die('Usage: npm run batch -- --file batches/<name>.json');
  return { file: file!, dryRun: argv.includes('--dry-run') };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function run(script: string, args: string[]): boolean {
  const res = spawnSync(process.execPath, [tsx, fromRoot('src', script), ...args], {
    cwd: fromRoot(),
    stdio: 'inherit',
    env: process.env,
  });
  return res.status === 0;
}

const args = parseArgs();
const jobsPath = path.isAbsolute(args.file) ? args.file : fromRoot(args.file);
if (!existsSync(jobsPath)) die(`No batch file at ${args.file}`);
const jobs = JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[];

// Planning and generating are one request each when they go cleanly, and up to
// three each with repairs. Reserve the pessimistic figure so a batch never dies
// mid-feature.
const WORST_CASE_PER_FEATURE = 6;

step(`${bold(String(jobs.length))} feature(s) queued — ${requestsToday()} request(s) used today, ${remainingToday()} left`);
if (args.dryRun) {
  for (const j of jobs) info(dim(`${j.site} / ${j.feature}${j.pages ? ` (${j.pages})` : ''}`));
  process.exit(0);
}

const done: string[] = [];
const failed: string[] = [];
const skipped: string[] = [];

for (const [i, job] of jobs.entries()) {
  const label = `${job.site} / ${job.feature}`;
  console.log();
  console.log(cyan('─'.repeat(70)));
  console.log(cyan(`  ${i + 1}/${jobs.length}  ${bold(label)}`));
  console.log(cyan('─'.repeat(70)));

  if (remainingToday() < WORST_CASE_PER_FEATURE) {
    warn(`only ${remainingToday()} request(s) left in the daily budget — stopping here rather than starting a feature it may not cover`);
    skipped.push(...jobs.slice(i).map(j => `${j.site} / ${j.feature}`));
    break;
  }

  const planFile = job.plan ?? `plans/${job.site}_${slug(job.feature)}.json`;

  if (!job.plan) {
    const planArgs = ['--site', job.site, '--feature', job.feature, '--force'];
    if (job.pages) planArgs.push('--pages', job.pages);
    if (job.maxTests) planArgs.push('--max-tests', String(job.maxTests));
    if (job.notes) planArgs.push('--notes', job.notes);
    if (!run('planner/run_planner.ts', planArgs)) {
      fail(`${label}: planning failed`);
      failed.push(label);
      continue;
    }
  } else {
    info(dim(`using the existing plan ${planFile}`));
  }

  if (!run('generator/run_generator.ts', ['--plan', planFile, '--force'])) {
    fail(`${label}: generation failed — the plan is on disk, so this can be retried alone`);
    failed.push(label);
    continue;
  }

  done.push(label);
}

console.log();
step(bold('Batch result'));
for (const d of done) ok(d);
for (const f of failed) fail(f);
for (const s of skipped) warn(`${s} — not attempted (daily budget)`);
info(dim(`${requestsToday()} request(s) used today, ${remainingToday()} left`));
if (done.length) info(`Now run the suites: npm run test -- --site <id>`);
process.exit(failed.length ? 1 : 0);
