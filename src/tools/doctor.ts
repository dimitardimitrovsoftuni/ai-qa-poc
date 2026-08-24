// Preflight check: is this machine able to run the pipeline?
// Reports every problem it finds rather than stopping at the first one.
//
//   npm run doctor

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { loadAiConfig, fromRoot, configuredPath } from '../lib/config.js';
import { listSites, loadSite } from '../sites/registry.js';
import { ok, fail, warn, info, step, bold, dim } from '../lib/log.js';

let problems = 0;
const bad = (msg: string, hint?: string) => { fail(msg); if (hint) info(hint); problems++; };

function run(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

step(bold('Toolchain'));

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok(`node ${process.versions.node}`);
else bad(`node ${process.versions.node} is too old`, 'Need Node 20+ (native fetch, ESM tsx).');

const python = process.env.PYTEST_PYTHON || 'python';
const pyVersion = run(python, ['--version']);
if (pyVersion) ok(`${python} → ${pyVersion}`);
else bad(`Python not runnable as "${python}"`, 'Install Python 3.10+ or set PYTEST_PYTHON in .env.');

const pytest = pyVersion ? run(python, ['-m', 'pytest', '--version']) : undefined;
if (pytest) ok(`pytest → ${pytest.split('\n')[0]}`);
else bad('pytest not importable', `Run: ${python} -m pip install -r requirements.txt`);

const pyPw = pyVersion ? run(python, ['-c', 'import playwright; print(playwright.__version__ if hasattr(playwright,"__version__") else "installed")']) : undefined;
if (pyPw) ok(`python playwright → ${pyPw}`);
else bad('python playwright not importable', `Run: ${python} -m pip install -r requirements.txt`);

step(bold('Node dependencies'));
for (const dep of ['playwright', 'dotenv', 'tsx']) {
  if (existsSync(fromRoot('node_modules', dep))) ok(`node_modules/${dep}`);
  else bad(`missing node_modules/${dep}`, 'Run: npm install');
}

// Node and Python each demand an exact chromium build, and a cache full of
// other builds looks fine right up to the moment a launch fails. So launch one
// for real in each language — the only check worth trusting. (Learned the hard
// way: a green "chromium installed" line sat next to a suite that could not
// start, because the pinned python playwright wanted a build nobody had.)
step(bold('Browsers'));

try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  ok('node playwright can launch chromium');
} catch (err) {
  bad(`node playwright cannot launch chromium: ${(err as Error).message.split('\n')[0]}`,
    'Run: npx playwright install chromium');
}

if (pyVersion) {
  const launched = run(python, ['-c',
    'from playwright.sync_api import sync_playwright\n' +
    'with sync_playwright() as p:\n' +
    '    b = p.chromium.launch(headless=True); b.close(); print("ok")',
  ]);
  if (launched?.includes('ok')) ok('python playwright can launch chromium');
  else bad('python playwright cannot launch chromium',
    `Run: ${python} -m playwright install chromium  (its pinned version may need a different browser build than node)`);
}

step(bold('Configuration'));
const cfg = loadAiConfig();
ok(`config/ai.config.json → backend=${cfg.backend}, ${Object.keys(cfg.roles).length} roles`);

const paidRoles = Object.entries(cfg.roles)
  .flatMap(([role, r]) => [r.model, ...r.fallbacks].map(m => ({ role, m })))
  .filter(({ m }) => !m.endsWith(':free') && m !== 'openrouter/free');
if (paidRoles.length === 0) ok('every configured model is a free variant');
else if (cfg.allowPaid) warn(`paid models configured with allowPaid=true: ${paidRoles.map(p => p.m).join(', ')}`);
else bad(`paid model ids configured while allowPaid=false: ${paidRoles.map(p => `${p.role}→${p.m}`).join(', ')}`,
  'Free-only is the point of this POC. Fix config/ai.config.json or set allowPaid.');

if (!existsSync(fromRoot('.env'))) {
  bad('no .env file', 'Run: cp .env.example .env   then fill in OPENROUTER_API_KEY');
} else {
  ok('.env present');
  if (process.env.OPENROUTER_API_KEY) ok('OPENROUTER_API_KEY set');
  else warn('OPENROUTER_API_KEY empty — capture works, but plan/generate/heal will not (see PLAN.md §8)');
}

step(bold('Site descriptors'));
const sitesDir = configuredPath('sites');
if (!existsSync(sitesDir)) {
  warn(`${path.relative(fromRoot(), sitesDir)} does not exist yet — add a descriptor (see PLAN.md)`);
} else if (listSites().length === 0) {
  warn('no site descriptors yet — add one under config/sites/ (see PLAN.md)');
} else {
  for (const id of listSites()) {
    try {
      const site = loadSite(id);
      ok(`${id} → ${site.name}, ${site.pages.length} page(s)`);
      // Which env vars a site needs is the descriptor's business, not the
      // doctor's — this file must stay free of any site-specific knowledge.
      for (const key of [site.auth.credentials.user, site.auth.credentials.password]) {
        if (process.env[key]) ok(`  ${key} set`);
        else warn(`  ${key} empty — login for "${id}" will fail`);
      }
    } catch (err) {
      bad(`${id}: ${(err as Error).message}`, 'Fix the descriptor; the pipeline validates it on every run.');
    }
  }
}

console.log();
if (problems === 0) {
  ok(bold('doctor: all good'));
} else {
  fail(bold(`doctor: ${problems} problem(s) to fix`));
  console.log(dim('  Nothing was changed. Fix the items above and re-run npm run doctor.'));
}
process.exit(problems === 0 ? 0 : 1);
