// Failing JUnit XML -> a patched locator.
//
//   npm run heal -- --site <id>
//   npm run heal -- --site <id> --dry-run          # propose, do not write
//   npm run heal -- --site <id> --max-fixes 1
//
// The healer re-captures the page as it exists NOW, hands the model the failing
// test, the page object that owns the locator, and the live selector list, and
// accepts exactly one kind of answer: a whole corrected file, or NO_FIX.
//
// A test that fails because the product is broken MUST reach a human. The
// prompt says so, the validation enforces it (no weakened assertions, no
// deleted tests), and NO_FIX is treated as a successful outcome, not an error.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { askModel } from '../ai/client.js';
import { captureSite } from '../capture/snapshot.js';
import { configuredPath, fromRoot } from '../lib/config.js';
import { loadCaptures, selectorCatalog } from '../lib/context.js';
import { healerSystem, healerUser } from '../lib/prompts.js';
import { loadSite, listSites } from '../sites/registry.js';
import { step, ok, warn, fail, info, die, bold, dim, green, red } from '../lib/log.js';

interface Failure {
  classname: string;
  name: string;
  text: string;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const site = get('--site');
  if (!site) die(`Usage: npm run heal -- --site <id> [--dry-run]   (sites: ${listSites().join(', ') || 'none'})`);
  return {
    site: site!,
    file: get('--file'),
    maxFixes: Number(get('--max-fixes') ?? 3),
    dryRun: argv.includes('--dry-run'),
    noCapture: argv.includes('--no-capture'),
  };
}

/** Minimal JUnit reader: enough for pytest's output, no XML dependency. */
function parseJUnit(xml: string): Failure[] {
  const failures: Failure[] = [];
  const cases = xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g);
  for (const [, attrs, body] of cases) {
    const bodyText = body ?? '';
    if (!/<(failure|error)\b/.test(bodyText)) continue;
    const attrText = attrs ?? '';
    // The leading boundary matters: a bare /name="/ also matches classname="…".
    const attr = (name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrText)?.[1] ?? '';
    const detail = /<(?:failure|error)\b([^>]*)>([\s\S]*?)<\/(?:failure|error)>/.exec(body ?? '');
    const message = detail ? /message="([^"]*)"/.exec(detail[1] ?? '')?.[1] ?? '' : '';
    const text = [message, detail?.[2] ?? '']
      .join('\n')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n').replace(/&#9;/g, '\t').replace(/&amp;/g, '&')
      .trim();
    failures.push({ classname: attr('classname'), name: attr('name'), text });
  }
  return failures;
}

/** A pytest classname maps to its module path: tests.<site>.test_x -> tests/<site>/test_x.py */
function sourceFromClassname(classname: string): string | undefined {
  const rel = `${classname.split('.').join('/')}.py`;
  const abs = fromRoot(rel);
  return existsSync(abs) ? abs : undefined;
}

/** Playwright puts the offending selector in its error text; find who owns it. */
function selectorFromFailure(text: string): string | undefined {
  const patterns = [
    /waiting for locator\(["'](.+?)["']\)/,
    /locator\(["'](.+?)["']\)/,
    /selector resolved to/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m?.[1]) return m[1].replace(/\\"/g, '"');
  }
  return undefined;
}

function findOwningFile(suiteDir: string, selector: string | undefined, testSource: string): { file: string; why: string } | undefined {
  const modelsDir = path.join(suiteDir, 'models');
  const models = existsSync(modelsDir)
    ? readdirSync(modelsDir).filter(f => f.endsWith('.py') && f !== '__init__.py').map(f => path.join(modelsDir, f))
    : [];

  if (selector) {
    const owning = models.filter(f => readFileSync(f, 'utf8').includes(selector));
    if (owning.length === 1) return { file: owning[0]!, why: `it declares the failing locator ${selector}` };
    if (owning.length > 1) {
      return { file: owning[0]!, why: `${owning.length} page objects declare ${selector}; taking the first` };
    }
  }

  // No selector in the error (an assertion failure, say): fall back to the page
  // objects the failing test file imports, but only if there is exactly one.
  const imported = [...readFileSync(testSource, 'utf8').matchAll(/from \.models\.(\w+) import/g)].map(m => m[1]!);
  const candidates = models.filter(f => imported.includes(path.basename(f, '.py')));
  if (candidates.length === 1) return { file: candidates[0]!, why: 'it is the only page object this test uses' };
  return undefined;
}

/** Compact line diff — what a reviewer actually needs to see. */
function printDiff(before: string, after: string): void {
  const a = before.split('\n');
  const b = after.split('\n');
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) console.log(`    ${red(`- ${a[i]!.trim()}`)}`);
    if (b[i] !== undefined) console.log(`    ${green(`+ ${b[i]!.trim()}`)}`);
    if (++shown >= 12) { info(dim('    ...diff truncated')); break; }
  }
  if (!shown) warn('    the model returned the file unchanged');
}

function compiles(code: string, name: string): string | undefined {
  const stage = path.join(configuredPath('context'), 'healing');
  mkdirSync(stage, { recursive: true });
  const target = path.join(stage, name);
  writeFileSync(target, code, 'utf8');
  try {
    execFileSync(process.env.PYTEST_PYTHON || 'python', ['-m', 'py_compile', target], { stdio: ['ignore', 'pipe', 'pipe'] });
    return undefined;
  } catch (err) {
    return String((err as { stderr?: Buffer }).stderr ?? err).slice(0, 300);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const site = loadSite(args.site);
  const suiteDir = fromRoot(site.testsDir);

  const xmlPath = args.file
    ? (path.isAbsolute(args.file) ? args.file : fromRoot(args.file))
    : path.join(configuredPath('reports'), `${site.id}.xml`);
  if (!existsSync(xmlPath)) die(`No report at ${path.relative(fromRoot(), xmlPath)}. Run: npm run test -- --site ${site.id}`);

  const failures = parseJUnit(readFileSync(xmlPath, 'utf8'));
  if (!failures.length) {
    ok(`nothing to heal — no failures in ${path.basename(xmlPath)}`);
    return;
  }

  step(`${bold(String(failures.length))} failing test(s) in ${path.basename(xmlPath)}`);
  for (const f of failures) info(dim(`- ${f.name}`));

  // The whole point: look at the page as it is now, not as it was when the test
  // was written.
  if (!args.noCapture) {
    step('re-capturing the live pages');
    await captureSite({ siteId: site.id, quiet: true });
  }
  const captures = loadCaptures(site.id);
  const liveSelectors = captures
    .map(c => `### page: ${c.page} (${c.url})\n${selectorCatalog(c)}`)
    .join('\n\n');

  const targets = failures.slice(0, args.maxFixes);
  if (failures.length > targets.length) {
    warn(`healing the first ${targets.length} of ${failures.length} failures (--max-fixes)`);
  }

  let healed = 0;
  let refused = 0;

  for (const failure of targets) {
    console.log();
    step(`${bold(failure.name)}`);

    const testSource = sourceFromClassname(failure.classname);
    if (!testSource) {
      warn(`cannot locate the source file for ${failure.classname} — skipping`);
      continue;
    }
    const selector = selectorFromFailure(failure.text);
    const owner = findOwningFile(suiteDir, selector, testSource);
    if (!owner) {
      warn('cannot tell which page object owns this failure — a human should look');
      refused++;
      continue;
    }
    info(dim(`patching ${path.relative(fromRoot(), owner.file)} — ${owner.why}`));

    const before = readFileSync(owner.file, 'utf8');
    const res = await askModel({
      role: 'healer',
      system: healerSystem(),
      prompt: healerUser({
        testName: failure.name,
        failureText: failure.text,
        sourcePath: path.relative(fromRoot(), owner.file).replace(/\\/g, '/'),
        sourceCode: before,
        liveSelectors,
      }),
      label: `heal-${failure.name}`,
    });

    const reply = res.text.trim();
    if (/^NO_FIX/i.test(reply)) {
      warn(`NO_FIX — ${reply.replace(/^NO_FIX[:\s]*/i, '').split('\n')[0]}`);
      info('That is the correct answer for a real defect. Nothing was changed.');
      refused++;
      continue;
    }

    const marker = /^FILE:\s*(.+)$/m.exec(reply);
    if (!marker) {
      warn('reply followed neither the FILE: nor the NO_FIX contract — ignoring it');
      refused++;
      continue;
    }
    let code = reply.slice(reply.indexOf(marker[0]) + marker[0].length).replace(/^\r?\n/, '');
    code = code.replace(/^```[a-zA-Z]*\r?\n/, '').replace(/\r?\n```\s*$/, '');
    if (!code.trim().endsWith('\n')) code = `${code.replace(/\s+$/, '')}\n`;

    const claimed = marker[1]!.trim().replace(/\\/g, '/');
    const expected = path.relative(fromRoot(), owner.file).replace(/\\/g, '/');
    if (claimed !== expected && !expected.endsWith(claimed)) {
      warn(`the model wants to patch "${claimed}" but the failing locator lives in "${expected}" — refusing`);
      refused++;
      continue;
    }

    const syntax = compiles(code, path.basename(owner.file));
    if (syntax) {
      warn(`the proposed file does not compile — refusing:\n${syntax}`);
      refused++;
      continue;
    }
    // Guard against "fixing" a test by making it check less.
    const beforeAsserts = (before.match(/expect\(/g) ?? []).length;
    const afterAsserts = (code.match(/expect\(/g) ?? []).length;
    if (afterAsserts < beforeAsserts) {
      warn(`the fix drops ${beforeAsserts - afterAsserts} assertion(s) — refusing. A healer must not weaken a test.`);
      refused++;
      continue;
    }
    if (/time\.sleep|wait_for_timeout/.test(code)) {
      warn('the fix adds a sleep — refusing.');
      refused++;
      continue;
    }

    printDiff(before, code);

    if (args.dryRun) {
      info(dim('--dry-run: nothing written'));
      continue;
    }
    copyFileSync(owner.file, `${owner.file}.pre_heal`);
    writeFileSync(owner.file, code, 'utf8');
    ok(`patched ${path.relative(fromRoot(), owner.file)} ${dim('(backup: .pre_heal)')}`);
    healed++;
  }

  console.log();
  if (healed) {
    ok(bold(`${healed} file(s) patched`));
    info(`Verify with: npm run test -- --site ${site.id}`);
  }
  if (refused) warn(`${refused} failure(s) left for a human — that is the healer working as intended, not failing`);
  if (!healed && !refused) fail('nothing was healed');
}

main().catch(err => die(err instanceof Error ? err.message : String(err)));
