// The whole story in one command: see a page, plan tests for it, write them,
// run them, break one on purpose, heal it, run again.
//
//   npm run demo -- --site <id> --feature "<name>"
//   npm run demo -- --site <id> --feature "<name>" --skip-capture   # reuse captures
//   npm run demo -- --site <id> --feature "<name>" --keep-break     # leave the break in place
//
// Every generated file this touches is restored at the end unless --keep-break
// is passed, so a demo leaves the repository exactly as it found it.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fromRoot } from '../lib/config.js';
import { loadSite, listSites } from '../sites/registry.js';
import { requestsToday, summary } from '../lib/usage.js';
import { step, ok, warn, fail, info, die, bold, dim, cyan } from '../lib/log.js';

const tsx = fromRoot('node_modules', 'tsx', 'dist', 'cli.mjs');

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const site = get('--site');
  const feature = get('--feature');
  if (!site || !feature) {
    die(`Usage: npm run demo -- --site <id> --feature "<name>"   (sites: ${listSites().join(', ') || 'none'})`);
  }
  return {
    site: site!,
    feature: feature!,
    pages: get('--pages'),
    skipCapture: argv.includes('--skip-capture'),
    keepBreak: argv.includes('--keep-break'),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Run one pipeline script as a child process; returns its exit code. */
function run(script: string, args: string[]): number {
  const res = spawnSync(process.execPath, [tsx, fromRoot('src', script), ...args], {
    cwd: fromRoot(),
    stdio: 'inherit',
    env: process.env,
  });
  return res.status ?? 1;
}

function banner(n: number, title: string): void {
  console.log();
  console.log(cyan(`${'━'.repeat(70)}`));
  console.log(cyan(`  ${n}. ${bold(title)}`));
  console.log(cyan(`${'━'.repeat(70)}`));
}

const args = parseArgs();
const site = loadSite(args.site);
const suiteDir = fromRoot(site.testsDir);
const testModule = `test_${slug(args.feature)}.py`;
const startRequests = requestsToday();

let stage = 0;

if (!args.skipCapture) {
  banner(++stage, `Look at the application — capture ${site.name}`);
  if (run('capture/snapshot.ts', ['--site', site.id, ...(args.pages ? ['--pages', args.pages] : [])]) !== 0) {
    die('capture failed');
  }
} else {
  info(dim('--skip-capture: reusing the existing captures'));
}

banner(++stage, `Plan tests for "${args.feature}" — a free model reads the captures`);
if (run('planner/run_planner.ts', ['--site', site.id, '--feature', args.feature, '--force',
  ...(args.pages ? ['--pages', args.pages] : [])]) !== 0) {
  die('planning failed');
}

banner(++stage, 'Generate pytest page objects and tests from the plan');
if (run('generator/run_generator.ts', ['--plan', `plans/${site.id}_${slug(args.feature)}.json`, '--force']) !== 0) {
  die('generation failed');
}

banner(++stage, 'Run the generated suite against the live site');
if (run('runner/run_tests.ts', ['--site', site.id, '--file', testModule]) !== 0) {
  fail('The freshly generated suite is not green. That is a finding — stopping here so it can be read.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Break something, the way a front-end change would.
// ---------------------------------------------------------------------------
banner(++stage, 'Break a locator on purpose — as a UI change would');

const modelsDir = path.join(suiteDir, 'models');
const pageObjects = existsSync(modelsDir)
  ? readdirSync(modelsDir).filter(f => f.endsWith('.py') && f !== '__init__.py')
  : [];
if (!pageObjects.length) die('no page objects to break');

const victimName = pageObjects[0]!;
const victim = path.join(modelsDir, victimName);
const original = readFileSync(victim, 'utf8');
const backup = `${victim}.demo_backup`;
copyFileSync(victim, backup);

const locatorLine = /page\.locator\((['"])(.+?)\1\)/.exec(original);
if (!locatorLine) die(`no locator found in ${victimName}`);
const broken = original.replace(locatorLine[0], `page.locator("#renamed-by-a-frontend-change")`);
writeFileSync(victim, broken, 'utf8');
warn(`${path.relative(fromRoot(), victim)}: ${locatorLine[2]} → #renamed-by-a-frontend-change`);

const restore = () => {
  if (existsSync(backup)) {
    copyFileSync(backup, victim);
    rmSync(backup, { force: true });
    rmSync(`${victim}.pre_heal`, { force: true });
    info(dim(`restored ${path.relative(fromRoot(), victim)}`));
  }
};

try {
  banner(++stage, 'Run again — the suite should now be red');
  const redCode = run('runner/run_tests.ts', ['--site', site.id, '--file', testModule]);
  if (redCode === 0) {
    warn('the suite stayed green after the break — that locator was not actually exercised.');
    warn('A test that passes with a broken locator is worth investigating.');
  } else {
    ok('red, as intended');
  }

  banner(++stage, 'Heal — re-read the live page and patch the locator');
  if (run('healer/run_healer.ts', ['--site', site.id, '--max-fixes', '1']) !== 0) {
    fail('healing failed');
  }

  banner(++stage, 'Run once more — the suite should be green again');
  if (run('runner/run_tests.ts', ['--site', site.id, '--file', testModule]) === 0) {
    ok(bold('green again — the loop closed'));
  } else {
    fail('still red after healing. Read the healer output above: it may have refused on purpose.');
  }
} finally {
  if (args.keepBreak) {
    warn(`--keep-break: leaving ${path.relative(fromRoot(), victim)} as the healer left it`);
    rmSync(backup, { force: true });
  } else {
    restore();
  }
}

// ---------------------------------------------------------------------------
banner(++stage, 'What it cost');
const s = summary();
const spentHere = requestsToday() - startRequests;
console.log(`  requests this demo:  ${bold(String(spentHere))}`);
console.log(`  requests all-time:   ${s.total.requests}`);
console.log(`  tokens all-time:     ${s.total.promptTokens} in / ${s.total.completionTokens} out`);
console.log(`  cost all-time:       ${bold(`$${s.total.cost.toFixed(4)}`)}`);
console.log();
if (s.total.cost === 0) ok(bold('every model call in this project has been free'));
