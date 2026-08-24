// Captured pages + a feature name -> a validated test plan.
//
//   npm run plan -- --site <id> --feature "login"
//   npm run plan -- --site <id> --feature "cart" --pages inventory,cart --max-tests 5
//
// The plan is only written to disk once it validates, so a bad model reply
// cannot poison the next stage. Validation errors are fed back to the model for
// a bounded number of repair attempts — cheaper and far more effective than a
// longer prompt.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { askModel } from '../ai/client.js';
import { configuredPath } from '../lib/config.js';
import { loadCaptures } from '../lib/context.js';
import { parseJsonReply } from '../lib/text.js';
import { plannerSystem, plannerUser, plannerRepair } from '../lib/prompts.js';
import { loadSite, listSites } from '../sites/registry.js';
import { validatePlan, type TestPlan } from './plan_schema.js';
import { step, ok, warn, fail, info, die, bold, dim } from '../lib/log.js';

const MAX_REPAIRS = 2;

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const site = get('--site');
  const feature = get('--feature');
  if (!site || !feature) {
    die(`Usage: npm run plan -- --site <id> --feature "<name>"   (sites: ${listSites().join(', ') || 'none'})`);
  }
  return {
    site: site!,
    feature: feature!,
    pages: get('--pages')?.split(',').map(s => s.trim()).filter(Boolean),
    maxTests: Number(get('--max-tests') ?? 6),
    notes: get('--notes'),
    force: argv.includes('--force'),
    // A canary run: one request, no retry, no fallback, no repair round. On a
    // free tier the answer to "is it serving prompts this size right now" should
    // cost one request — the alternative was six per attempt, and a day was
    // spent that way.
    once: argv.includes('--once'),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function main(): Promise<void> {
  const args = parseArgs();
  const site = loadSite(args.site);
  const captures = loadCaptures(args.site, args.pages);

  const outDir = configuredPath('plans');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${site.id}_${slug(args.feature)}.json`);
  if (existsSync(outFile) && !args.force) {
    die(`${path.basename(outFile)} already exists. Re-run with --force to overwrite it.`);
  }

  step(`Planning ${bold(args.feature)} for ${bold(site.name)} ${dim(`(${captures.length} captured page(s): ${captures.map(c => c.page).join(', ')})`)}`);

  const system = plannerSystem();
  let prompt = plannerUser({ site, captures, feature: args.feature, maxTests: args.maxTests, notes: args.notes });
  info(dim(`prompt: ${(prompt.length / 1000).toFixed(1)}k chars`));

  let plan: TestPlan | undefined;
  let model = '';
  let repairs = 0;

  const maxRepairs = args.once ? 0 : MAX_REPAIRS;
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const res = await askModel({
      role: 'planner',
      system,
      prompt,
      label: `plan-${slug(args.feature)}${attempt ? `-repair${attempt}` : ''}`,
      once: args.once,
    });
    model = res.model;

    let candidate: TestPlan;
    try {
      candidate = parseJsonReply<TestPlan>(res.text);
    } catch (err) {
      const msg = (err as Error).message;
      warn(`unparseable reply: ${msg}`);
      if (attempt === maxRepairs) die(`Planner never returned valid JSON. Raw replies are in ${path.basename(configuredPath('context'))}/replies/.`);
      prompt = plannerRepair(res.text.slice(0, 8000), [`The reply was not valid JSON: ${msg}`], args.feature);
      repairs++;
      continue;
    }

    const errors = validatePlan(candidate, captures, args.feature);
    if (errors.length === 0) {
      plan = candidate;
      break;
    }

    warn(`${errors.length} validation error(s)${attempt < maxRepairs ? ' — asking the model to fix them' : ''}`);
    for (const e of errors.slice(0, 12)) info(dim(`- ${e}`));
    if (errors.length > 12) info(dim(`  ...and ${errors.length - 12} more`));

    if (attempt === maxRepairs) {
      fail(args.once
        ? 'Plan invalid, and --once means no repair round. Re-run without --once to let it fix itself.'
        : `Plan still invalid after ${maxRepairs} repair attempt(s) — nothing written.`);
      info('This is a finding, not just a failure: note which rules the model could not follow.');
      process.exit(1);
    }
    prompt = plannerRepair(JSON.stringify(candidate, null, 2), errors, args.feature);
    repairs++;
  }

  if (!plan) die('Planner produced no plan.');

  plan.site = site.id;
  plan.feature = args.feature;
  plan.meta = {
    model,
    generatedAt: new Date().toISOString(),
    pagesUsed: captures.map(c => c.page),
    repairs,
  };

  writeFileSync(outFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  ok(`${bold(String(plan.tests.length))} test(s) planned${repairs ? ` after ${repairs} repair round(s)` : ' on the first attempt'}`);
  for (const t of plan.tests) {
    console.log(`  ${dim('•')} ${t.name} ${dim(`— ${t.title}`)}`);
    info(dim(`  ${t.steps.length} steps, ${t.expected.length} expectation(s), pages: ${t.pages.join(', ')}`));
  }
  ok(`written to ${path.relative(process.cwd(), outFile)}`);
}

main().catch(err => die(err instanceof Error ? err.message : String(err)));
