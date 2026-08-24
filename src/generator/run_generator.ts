// A validated plan -> runnable pytest files.
//
//   npm run generate -- --plan plans/<site>_<feature>.json [--force]
//
// APPEND-ONLY by design. The model writes whole files only for screens that have
// no page object yet; for a screen that already has one it emits just the members
// it needs added, and this file merges them in. Everything else follows from that
// choice:
//
//   * it cannot delete a method another suite calls, or rewrite one's body —
//     both of which happened when it was asked for whole files;
//   * the prompt shrinks as a suite grows instead of growing with it, which
//     matters because free endpoints refuse the largest requests;
//   * existing page objects can be shown as interfaces (signatures, no bodies),
//     because the model never has to reproduce an implementation.
//
// Nothing reaches the suite until it passes the gates in validateFiles() and the
// real Python compiler. Failures are fed back to the model with the reason.
// `npm run gates` proves the gates still fire.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askModel } from '../ai/client.js';
import { configuredPath, fromRoot } from '../lib/config.js';
import { loadCaptures, selectorsFor, type CapturedElement } from '../lib/context.js';
import { loadSite } from '../sites/registry.js';
import { ADD_MARKER, FILE_MARKER, generatorSystem, generatorUser, generatorRepair } from '../lib/prompts.js';
import type { TestPlan } from '../planner/plan_schema.js';
import { step, ok, warn, fail, info, die, bold, dim } from '../lib/log.js';

const MAX_REPAIRS = 2;
const referenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference');

export interface GeneratedFile {
  relPath: string;
  content: string;
  /** 'add' = members to merge into an existing page object. Default 'file'. */
  kind?: 'file' | 'add';
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const plan = get('--plan');
  if (!plan) die('Usage: npm run generate -- --plan plans/<site>_<feature>.json');
  return {
    plan: plan!,
    force: argv.includes('--force'),
    // Canary mode: exactly one request — no transport retry, no fallback chain,
    // no repair round. It separates the two questions that a retry loop blurs
    // together: did the endpoint serve this at all, and was the answer good.
    once: argv.includes('--once'),
    // Pick up the last reply this plan produced, re-validate it, and send ONE
    // repair request. A reply that the gates rejected has already been paid for;
    // throwing it away and starting over costs two requests instead of one.
    repairFromLast: argv.includes('--repair-from-last'),
    // Pin one endpoint instead of the role's chain — see AskParams.model.
    model: get('--model'),
    // Re-judge every saved reply for this plan against the CURRENT gates and
    // print the verdicts. Sends nothing. A reply that was rejected has already
    // been paid for, and when a gate itself turns out to be wrong the honest
    // question — "how good was that answer really?" — should not cost another
    // request to ask.
    validateOnly: argv.includes('--validate-only'),
    // Write the best saved reply if it passes the CURRENT gates, without asking
    // the model anything. The sibling of --validate-only: when a reply was
    // rejected because the tooling was wrong, the fix should not cost a request
    // to apply.
    applyLast: argv.includes('--apply-last'),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const norm = (p: string) => p.replace(/\\/g, '/');

/** Few-shot: the reference files, in the same block format the model must emit. */
function referenceBlocks(): string {
  // Two files, not three. The example has to show a page object and a test file;
  // a second page object only demonstrated an import, and the free endpoints
  // charge for every character of it.
  // Named example_page, not something plausible like sign_in_page. The example
  // used to be a realistic sign-in page object, and two different models copied
  // its import — .models.sign_in_page — straight into a suite that has no such
  // file. A format sample that reads like real code gets treated as real code, so
  // the name now says what it is.
  const files: [string, string][] = [
    ['models/example_page.py', 'example_page.py'],
    ['test_example.py', 'test_example.py'],
  ];
  return files
    .map(([rel, file]) => `${FILE_MARKER}${rel} ===\n${readFileSync(path.join(referenceDir, file), 'utf8')}`)
    .join('\n');
}

/** Render a plan as one line per step instead of JSON.
 *
 *  The generator needs the mechanics of a plan, not its prose and not its
 *  punctuation. Pretty-printed JSON spends five lines and a dozen braces per
 *  step; for a 37-step plan that is 4.5k characters against 2.5k, with nothing
 *  lost that the model uses. */
function slimPlan(plan: TestPlan): string {
  const lines = [`site: ${plan.site}`, `feature: ${plan.feature}`, ''];
  for (const t of plan.tests) {
    lines.push(`TEST ${t.name}`);
    lines.push(`  title: ${t.title}`);
    lines.push(`  pages: ${t.pages.join(', ')}`);
    if (t.preconditions?.length) lines.push(`  preconditions: ${t.preconditions.join('; ')}`);
    t.steps.forEach((s, i) => {
      const parts = [`${String(i + 1).padStart(2)}. ${s.action}`];
      if (s.selector) parts.push(s.selector);
      if (s.value !== undefined) parts.push(`value=${JSON.stringify(s.value)}`);
      lines.push(`  ${parts.join('  ')}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

/** Every selector the plan uses, annotated with what was observed there — and
 *  crucially, how MANY elements matched it.
 *
 *  Playwright runs in strict mode: `expect(locator).to_be_visible()` on a
 *  selector matching nine product titles fails with a strict-mode violation, not
 *  a useful message. The capture already knows the count, so the model is told
 *  rather than left to find out at runtime. */
function selectorNotes(plan: TestPlan, elements: Map<string, CapturedElement[]>): string {
  const used = new Set<string>();
  for (const t of plan.tests) for (const s of t.steps) if (s.selector) used.add(s.selector);
  return [...used]
    .map(sel => {
      const hits = elements.get(sel) ?? [];
      const el = hits[0];
      const what = el
        ? `${el.tag}${el.type ? `[type=${el.type}]` : ''}${el.text ? ` text="${el.text}"` : ''}`
        : 'not found in captures';
      const many = hits.length > 1
        ? `   MATCHES ${hits.length} ELEMENTS — chain .first (or .nth(i)) when asserting on one, or assert to_have_count`
        : '';
      return `  ${sel}   ->  ${what}${many}`;
    })
    .join('\n');
}

/** Selectors that match more than one element ON A SINGLE PAGE. */
function multiMatchSelectors(plan: TestPlan, elements: Map<string, CapturedElement[]>): Set<string> {
  const out = new Set<string>();
  for (const t of plan.tests) {
    for (const s of t.steps) {
      if (s.selector && (elements.get(s.selector)?.length ?? 0) > 1) out.add(s.selector);
    }
  }
  return out;
}

/** Split a reply into blocks. Tolerates fences and stray blank lines. */
export function parseFileBlocks(reply: string): GeneratedFile[] {
  const whole = FILE_MARKER.trim();
  const add = ADD_MARKER.trim();
  const blocks: GeneratedFile[] = [];
  let current: GeneratedFile | undefined;

  for (const line of reply.split(/\r?\n/)) {
    const marker = line.trim();
    const kind = marker.startsWith(add) ? 'add' : marker.startsWith(whole) ? 'file' : undefined;
    if (kind) {
      const lead = kind === 'add' ? add : whole;
      const relPath = marker
        .slice(marker.indexOf(lead) + lead.length)
        .replace(/=+\s*$/, '')
        .replace(/^:/, '')
        .trim();
      // A page object named without its directory still means the models folder.
      //
      // A repair reply wrote "ADD TO: cart_page.py" instead of
      // "ADD TO: models/cart_page.py" and drew three errors saying no such page
      // object exists - for three files that all exist. There is exactly one place
      // a *_page.py can live, so the prefix is restored rather than argued about.
      const withDir = /^[a-z0-9_]+_page\.py$/.test(relPath)
        ? `models/${relPath}`
        : relPath;
      current = { relPath: withDir, content: '', kind };
      blocks.push(current);
      continue;
    }
    if (!current) continue;                      // preamble before the first block
    if (/^```/.test(marker)) continue;           // a fence the model added anyway
    // Models like to close what they opened: "=== END ===", "=== EOF ===". Those
    // are not part of the file, and left in they produce a SyntaxError that costs
    // a repair round to discover. Drop anything shaped like a marker we do not
    // recognise rather than writing it into Python.
    if (/^={2,}[^=]*={2,}$/.test(marker)) continue;
    current.content += `${line}\n`;
  }

  return blocks
    .map(b => ({ ...b, content: b.content.replace(/\n{3,}$/, '\n') }))
    .filter(b => b.relPath && b.content.trim());
}

/** The BEST saved reply for this feature — fewest validation problems, newest
 *  wins a tie. Every reply is written to .ai_context/replies/ precisely so a
 *  rejected one can be picked up again instead of re-requested.
 *
 *  It used to take the newest, and that quietly made things worse: replies can
 *  degrade, and repairing a degraded reply carries its damage forward. Observed
 *  going 5 -> 8 -> 9 problems across three rounds, because round three was
 *  repairing round two's reply, which had already lost the plan's tests. Judge the
 *  candidates instead of assuming the last one is the best one. */
interface JudgedReply { file: string; text: string; errors: string[] }

/**
 * Every saved reply for a feature, newest first, each with its verdict.
 *
 * Replies older than the plan are discarded. A saved reply is only an answer to
 * the plan it was generated from, and the gates cannot tell: they check that a
 * test is well-formed, not that its literal values match the plan's. Correcting a
 * plan's expected cart count from 1 to 2 and then applying a reply from before the
 * correction produced a test that passed every gate and failed on the assertion
 * the correction was for.
 */
function savedRepliesFor(feature: string, judge: (text: string) => string[], planPath?: string): JudgedReply[] {
  const dir = path.join(configuredPath('context'), 'replies');
  if (!existsSync(dir)) return [];
  const tag = `gen-${slug(feature)}`;
  const planTime = planPath && existsSync(planPath) ? statSync(planPath).mtimeMs : 0;
  const stampOf = (file: string) => {
    // 2026-08-22T13-55-24-229Z... -> a Date
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(file);
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : 0;
  };
  return readdirSync(dir)
    .filter(f => f.includes(tag) && f.endsWith('.txt'))
    .filter(f => stampOf(f) >= planTime)
    .sort()
    .reverse()
    .map(file => {
      const text = readFileSync(path.join(dir, file), 'utf8');
      return { file, text, errors: judge(text) };
    })
    .filter(c => parseFileBlocks(c.text).length > 0);
}

function bestReplyFor(
  feature: string,
  judge: (text: string) => string[],
  planPath?: string,
): JudgedReply | undefined {
  const scored = savedRepliesFor(feature, judge, planPath);
  if (!scored.length) return undefined;
  // Fewest problems, not newest. Repairing the newest reply compounded damage
  // across three probes (5 -> 8 -> 9 problems) before this was noticed.
  return scored.reduce((best, c) => (c.errors.length < best.errors.length ? c : best));
}

/** Page objects already on disk. */
function existingPageObjects(suiteDir: string): Map<string, string> {
  const dir = path.join(suiteDir, 'models');
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .filter(f => f.endsWith('.py') && f !== '__init__.py')
      .map(f => [`models/${f}`, readFileSync(path.join(dir, f), 'utf8')] as [string, string]),
  );
}

/** One line per existing page object: its class, its locator attributes, its
 *  methods. Nothing else.
 *
 *  Three rounds got here. Full source grew the prompt with the suite. Signature
 *  interfaces were smaller but still ~800 characters each, and showing all six of
 *  them put a one-test feature back at 17.1k. What the model actually needs is
 *  only "does this exist, and what can I call on it" — this index answers that in
 *  about a hundred characters per file, and it stays flat as the suite grows. */
/**
 * What already exists, for the model to add to rather than duplicate.
 *
 * Locator NAMES are listed for every page object; the selector behind each name
 * is spelled out only for the files this feature actually touches. That split is
 * the whole design: naming everything is cheap and stops the model redefining a
 * class, but a name alone is not enough to REUSE a locator.
 *
 * The cost of getting this wrong was measured. With names only, a 550B model
 * needed a locator for the selected sort option, saw that `active_option`
 * existed, could not see that it already pointed at [data-test="active-option"],
 * and invented `option:checked` instead — then took two gate violations for it.
 * It had been asked to reuse something it was not allowed to look at. Spelling
 * out every selector in every file would fix that and push the prompt past the
 * size the free tier will serve, so detail goes only where it is needed.
 *
 * The arrow is not decoration. Listing a locator as `name = selector` cost a
 * round: the model copied that shape into Python and emitted
 * `nav_favorites = [data-test="nav-favorites"]`, which is a syntax error.
 * Reference material that looks like code gets used as code, so the notation has
 * to be one the target language cannot parse.
 */
export function pageObjectIndex(
  existing: Map<string, string>,
  planSelectors: Set<string> = new Set(),
  /** Page names the plan's tests declare they use. */
  planPages: Set<string> = new Set(),
): string {
  const detailed: string[] = [];
  const bystanders: string[] = [];

  for (const [rel, code] of existing) {
    const cls = /class\s+([A-Z]\w*Page)\b/.exec(code)?.[1] ?? '?';
    const pairs = [...code.matchAll(LOCATOR_WITH_SELECTOR)].map(m => ({ name: m[1]!, selector: m[3]! }));
    const methods = [...memberBodies(code).keys()].filter(n => n !== '__init__');

    // Relevance comes from the plan's own "pages" list first, and only falls back
    // to selector overlap when the file name does not map to a captured page.
    //
    // Selector overlap alone was too generous: one shared selector marked a whole
    // file relevant, so a plan about cancelling checkout was shown the product
    // detail page object in full. Five files expanded instead of three, 1.5k of a
    // 12k prompt spent on pages the test never visits. The plan already declares
    // which pages each test uses; that is the better signal and it is free.
    const pageName = /^models\/(.+)_page\.py$/.exec(rel)?.[1];
    const relevant = pageName && planPages.size
      ? planPages.has(pageName)
      : pairs.some(pair => planSelectors.has(pair.selector));
    if (!relevant) {
      bystanders.push(cls);
      continue;
    }

    const locators = pairs.map(pair => `\n      ${pair.name}  ->  ${pair.selector}`).join('');
    detailed.push([
      `${rel}  ->  class ${cls}`,
      `    locators:${locators}`,
      `    methods:  ${methods.map(n => `${n}(${paramsOf(code, n)})`).join(', ') || '(none)'}`,
    ].join('\n'));
  }

  if (bystanders.length) {
    detailed.push(`also on disk, not part of this feature: ${bystanders.join(', ')}`);
  }
  return detailed.join('\n');
}

/** The parameter list of a method as written, minus self. */
function paramsOf(source: string, method: string): string {
  const def = new RegExp(String.raw`def\s+` + method + String.raw`\s*\(([^)]*)\)`).exec(source);
  if (!def) return '';
  return splitArgs(def[1] ?? '')
    .map(p => p.trim())
    .filter(p => p && p !== 'self')
    // Annotations kept, deliberately. Stripping them showed the model
    // expect_badge_count(count) when the source says count: str; it passed the
    // integer 2, the method handed that to to_contain_text, and Playwright threw
    // "value must be a string or regular expression". A parameter name without
    // its type is half an interface, and the missing half is the half that fails.
    .join(', ');
}

/** Positional parameter type annotations of a method, excluding self. */
function annotationsOf(source: string, method: string): (string | undefined)[] | undefined {
  const def = new RegExp(String.raw`def\s+` + method + String.raw`\s*\(([^)]*)\)`).exec(source);
  if (!def) return undefined;
  return splitArgs(def[1] ?? '')
    .map(p => p.trim())
    .filter(p => p && p !== 'self' && !p.startsWith('*'))
    .map(p => {
      const colon = p.indexOf(':');
      if (colon < 0) return undefined;
      return p.slice(colon + 1).split('=')[0]!.trim();
    });
}
/** Parameters of a `def`, excluding self, split into required and total. */
function signatureOf(source: string, method: string): { required: number; accepted: number } | undefined {
  const def = new RegExp(String.raw`def\s+` + method + String.raw`\s*\(([^)]*)\)`).exec(source);
  if (!def) return undefined;
  const params = splitArgs(def[1] ?? '')
    .map(p => p.trim())
    .filter(p => p && p !== 'self' && !p.startsWith('*'));
  return {
    required: params.filter(p => !p.includes('=')).length,
    accepted: params.length,
  };
}

/** Split an argument list on top-level commas only. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}
/** Every page name the plan's tests declare. */
function planPageSet(plan: TestPlan): Set<string> {
  const out = new Set<string>();
  for (const t of plan.tests) for (const p of t.pages ?? []) out.add(p);
  return out;
}

/** Every selector the plan names. */
function planSelectorSet(plan: TestPlan): Set<string> {
  const out = new Set<string>();
  for (const t of plan.tests) for (const s of t.steps) if (s.selector) out.add(s.selector);
  return out;
}

/** member name -> body, whitespace-normalised, for every `def` in a file. */
export function memberBodies(code: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | undefined;
  let body: string[] = [];
  const flush = () => { if (current) out.set(current, body.join('\n').trim()); };
  for (const line of code.split(/\r?\n/)) {
    const def = /^\s*def\s+(\w+)/.exec(line);
    if (def) { flush(); current = def[1]!; body = []; continue; }
    if (current) body.push(line.trim());
  }
  flush();
  return out;
}

const LOCATOR_LINE = /^\s*(self\.\w+\s*=\s*page\.locator\(.*)$/;
// Quote-aware on purpose: a Playwright selector is normally written in single
// quotes and CONTAINS double quotes ([data-test="cart-list"]). A naive
// [^'"]+ capture stops at the first inner quote and yields `[data-test=`,
// which then matches nothing in the plan - so every file looked irrelevant and
// the index silently fell back to names only. The backreference ends the
// capture at the same quote that opened it.
const LOCATOR_WITH_SELECTOR = /self\.(\w+)\s*=\s*page\.locator\(\s*(['"])(.*?)\2/g;

/** Split an "add" block into locator attributes and method definitions. */
export function splitAddition(addition: string): { locators: string[]; methods: string[] } {
  const locators: string[] = [];
  const methods: string[] = [];
  let inMethod = false;
  for (const line of addition.split(/\r?\n/)) {
    if (/^\s*def\s+\w+/.test(line)) { inMethod = true; methods.push(line); continue; }
    if (inMethod) { methods.push(line); continue; }
    // A locator written without `self.` is normalised, not rejected. Inside an
    // ADD TO block for a page object there is only one thing
    // `nav_favorites = page.locator(...)` can mean.
    //
    // Leaving it alone cost a round and reported TWO problems for one cause: the
    // line fell through to `methods`, was appended after the last def in the
    // file, and so landed inside the body of expect_loaded() — which then tripped
    // the "existing method would change" gate as well. The bare-locator gate
    // still fires for a whole-file block, where the model chose the class-level
    // assignment deliberately.
    const bare = /^\s*(\w+)\s*=\s*(page\.locator\(.*)$/.exec(line);
    if (bare && !line.trim().startsWith('self.')) {
      locators.push(`self.${bare[1]} = ${bare[2]}`);
      continue;
    }
    const loc = LOCATOR_LINE.exec(line);
    if (loc) { locators.push(loc[1]!.trim()); continue; }
    if (line.trim()) methods.push(line);         // stray content — let the gates judge it
  }
  return { locators, methods };
}

/**
 * Merge an addition into an existing page object: locator attributes go after the
 * last one in __init__, methods go at the end of the class. Purely mechanical —
 * the model never sees, and so never rewrites, what is already there.
 */
export function mergeAddition(existing: string, addition: string): string {
  const { locators } = splitAddition(addition);
  let { methods } = splitAddition(addition);
  const lines = existing.replace(/\s+$/, '').split(/\r?\n/);

  if (locators.length) {
    let last = -1;
    let indent = '        ';
    lines.forEach((line, i) => {
      const m = /^(\s*)self\.\w+\s*=\s*page\.locator\(/.exec(line);
      if (m) { last = i; indent = m[1]!; }
    });
    if (last < 0) {
      // No locators yet: put them right after the `self.page = page` line.
      last = lines.findIndex(l => /^\s*self\.page\s*=\s*page\b/.test(l));
      if (last < 0) last = lines.findIndex(l => /def __init__/.test(l));
    }
    lines.splice(last + 1, 0, ...locators.map(l => `${indent}${l}`));
  }

  // Methods are re-indented to class-body level when the reply sent them flush
  // left, which models do routinely — the block format says which class to add
  // to, not how far to indent.
  //
  // Merging them verbatim put four `def`s at column 0, so they became
  // module-level functions instead of methods, and every test died on
  // 'AccountPage' object has no attribute 'open'. The intent of an ADD TO block
  // for a page object is unambiguous, so this is normalised rather than rejected:
  // spending a model request on an indentation nit that can be fixed
  // deterministically is a bad trade.
  // A re-sent member with a byte-identical body is context, not a change.
  //
  // Models routinely include a neighbouring method so the addition reads as
  // coherent code. Appending it would put a second def of the same name in the
  // class; rejecting it burns a request on a reply that was already correct. So
  // an identical body is dropped here, and a DIFFERENT body still fails the
  // 'existing method would change' gate, which is the case that actually matters.
  const before = memberBodies(existing);
  const kept: string[] = [];
  let skipping = false;
  for (const line of methods) {
    const def = /^\s*def\s+(\w+)/.exec(line);
    if (def) {
      const name = def[1]!;
      const chunk: string[] = [line];
      skipping = false;
      // Look ahead over this member's body to compare it with what exists.
      const start = methods.indexOf(line);
      for (let j = start + 1; j < methods.length; j++) {
        if (/^\s*def\s+\w+/.test(methods[j]!)) break;
        chunk.push(methods[j]!);
      }
      const body = chunk.slice(1).map(l => l.trim()).join('\n').trim();
      if (before.has(name) && before.get(name)!.trim() === body) skipping = true;
    }
    if (!skipping) kept.push(line);
  }
  methods = kept;

  const flushLeft = methods.some(l => /^def\s+\w+/.test(l));
  const shaped = flushLeft
    ? methods.map(l => (l.trim() ? `    ${l}` : l))
    : methods;

  const body = shaped
    .join('\n')
    .replace(/^\s*\n/, '')
    .replace(/\s+$/, '');
  return `${lines.join('\n')}\n${body ? `\n${body}\n` : ''}`;
}

export function validateFiles(
  files: GeneratedFile[],
  plan: TestPlan,
  testModule: string,
  existing: Map<string, string>,
  /** Selectors the capture matched on more than one element. */
  multiMatch: Set<string> = new Set(),
  /** Per capture page, the selectors that match several elements ON THAT page. */
  multiMatchByPage: Map<string, Set<string>> = new Map(),
): string[] {
  const errors: string[] = [];
  if (!files.length) {
    return [`No blocks found. Every file must start with "${FILE_MARKER}<path> ===" or "${ADD_MARKER}<path> ===".`];
  }

  const planSelectors = new Set<string>();
  for (const t of plan.tests) for (const s of t.steps) if (s.selector) planSelectors.add(s.selector);

  // What each produced file will look like once merged, so every gate below
  // judges the code that will actually run.
  const resulting = new Map<string, string>();
  for (const f of files) {
    const rel = norm(f.relPath);
    const before = existing.get(rel);
    if (f.kind === 'add') {
      if (!before) {
        errors.push(
          `${rel}: there is no such page object yet, so it cannot be added to. ` +
          `Emit the whole file with "${FILE_MARKER}${rel} ===" instead.`,
        );
        continue;
      }
      const added = [...memberBodies(f.content).keys()];
      // __init__ is exempt, and the exemption is load-bearing. An addition that
      // introduces a locator HAS to re-send __init__ — that is where locators
      // live and how mergeAddition folds them in. Flagging it as a duplicate
      // punished a reply for obeying the contract: a 550B model produced a
      // coherent test and two of its seven "problems" were this gate arguing
      // with the format it had been told to use. The "nothing removed" gate
      // below is what actually guards __init__.
      const beforeBodies = memberBodies(before);
      const addedBodies = memberBodies(f.content);
      const clash = added
        .filter(name => name !== '__init__')
        .filter(name => beforeBodies.has(name))
        // An identical body is the model quoting itself for context — harmless,
        // and dropped by mergeAddition. Only a genuine redefinition is a clash.
        .filter(name => beforeBodies.get(name)!.trim() !== (addedBodies.get(name) ?? '').trim());
      if (clash.length) {
        errors.push(
          `${rel}: ${clash.join(', ')} already exist(s) there. Add only what is missing, and ` +
          'reuse the existing method rather than defining it again.',
        );
      }
      resulting.set(rel, mergeAddition(before, f.content));
    } else {
      if (before && rel.startsWith('models/')) {
        // Should never be reached: normalizeBlocks() converts these before any
        // validation. Kept as a guard so a caller that forgets to normalise gets
        // an error instead of a silently overwritten page object.
        errors.push(
          `${rel} arrived as a whole file for an existing page object. This should have ` +
          'been normalised into an addition before validation — the caller skipped ' +
          'normalizeBlocks().',
        );
        continue;
      }
      if (false) {
        errors.push(
          `${rel} already exists. Do not send it as a whole file — send only the members you need ` +
          `added, with "${ADD_MARKER}${rel} ===".`,
        );
        continue;
      }
      resulting.set(rel, f.content);
    }
  }

  for (const [rel, content] of resulting) {
    // A def at column 0 in a page object is a module-level function, not a
    // method — Python cares about the indentation that memberBodies() does not.
    // That blind spot let a file through whose four "methods" sat outside the
    // class: every gate passed, and every test died on 'AccountPage' object has
    // no attribute 'open'. mergeAddition now re-indents an unindented addition,
    // so this guards the remaining route in — a whole-file block.
    if (rel.startsWith('models/')) {
      // A locator assigned without `self.` is a class-level attribute evaluated at
      // import time, where the name `page` does not exist yet. It compiles
      // perfectly — py_compile checks syntax, not names — so it would reach the
      // suite and fail on import with a NameError, which is the worst place to
      // find it. Seen in a repair reply that wrote nav_favorites = page.locator(...)
      // three times over.
      for (const bare of content.matchAll(/^\s+(\w+)\s*=\s*page\.locator\(/gm)) {
        errors.push(
          `${rel}: ${bare[1]} = page.locator(...) is missing self. — assign it as ` +
          `self.${bare[1]} inside __init__, or it runs at class level where page does not exist.`,
        );
      }
      // A locator attribute called with a to_* or expect_* method is an invented
      // API. Those live on the assertion object — expect(self.x).to_be_visible() —
      // never on the Locator itself, and a model that half-remembers the
      // distinction writes self.x.expect_visible(), which is syntactically fine,
      // passes every other gate, and dies at runtime with
      // "'Locator' object has no attribute 'expect_visible'".
      //
      // Only attributes this file declares as locators are judged, so there are no
      // false positives from some other object that legitimately has such a method.
      const locatorAttrs = new Set(
        [...content.matchAll(LOCATOR_WITH_SELECTOR)].map(m => m[1]!),
      );
      for (const call of content.matchAll(/self\.(\w+)\.((?:to_|expect_)\w*)\s*\(/g)) {
        const [, attr, method] = call as unknown as [string, string, string];
        if (!locatorAttrs.has(attr)) continue;
        errors.push(
          `${rel}: self.${attr}.${method}() is not a Playwright API — a Locator has no ` +
          `${method}. Assert with expect(self.${attr}).to_be_visible() (or the matching to_* form).`,
        );
      }
      const stray = content.split(/\r?\n/)
        .filter(l => /^def\s+\w+/.test(l))
        .map(l => /^def\s+(\w+)/.exec(l)![1]!);
      if (stray.length) {
        errors.push(
          `${rel}: ${stray.join(', ')} sit at column 0, outside the class, so they are ` +
          'module-level functions and not methods. Indent every method into the class body.',
        );
      }
    }
    if (rel.includes('..') || path.isAbsolute(rel)) {
      errors.push(`${rel}: path must be relative and inside the suite directory.`);
      continue;
    }
    if (!/^models\/[a-z0-9_]+\.py$/.test(rel) && !/^test_[a-z0-9_]+\.py$/.test(rel)) {
      errors.push(`${rel}: only "models/<name>_page.py" and "test_<name>.py" may be produced (got "${rel}").`);
    }
    if (rel.startsWith('models/')) {
      if (!/class\s+[A-Z]\w*Page\b/.test(content)) {
        errors.push(`${rel}: must define a page-object class whose name ends in "Page".`);
      }
      if (!/from playwright\.sync_api import .*expect/.test(content)) {
        errors.push(`${rel}: must import expect from playwright.sync_api — assertions live in page objects.`);
      }
    }
    if (/time\.sleep|page\.wait_for_timeout/.test(content)) {
      errors.push(`${rel}: remove the sleep. Playwright auto-waits and expect() retries.`);
    }

    // The core guard: no locator string the plan did not sanction. Locators
    // inherited from an earlier feature stay legal.
    const carriedOver = new Set(
      [...(existing.get(rel) ?? '').matchAll(/\.locator\(\s*(['"])([\s\S]*?)\1\s*\)/g)].map(m => m[2]!),
    );
    for (const m of content.matchAll(/\.locator\(\s*(['"])([\s\S]*?)\1\s*\)/g)) {
      const selector = m[2]!;
      if (!planSelectors.has(selector) && !carriedOver.has(selector)) {
        errors.push(
          `${rel}: locator("${selector}") is neither in the plan nor already in this file. ` +
          `Allowed selectors: ${[...planSelectors, ...carriedOver].join('  ')}`,
        );
      }
    }

    // Playwright is strict: a singular assertion on a locator that matches many
    // elements raises a strict-mode violation, which reads like a selector bug and
    // is not one. The capture knows the count, so this is checkable before the
    // suite ever runs.
    if (rel.startsWith('models/')) {
      // A page object's locators are judged against ITS OWN page, not against
      // every capture at once.
      //
      // The global set is the maximum across all pages, and that over-reaches:
      // [data-test="inventory-item-name"] matches nine elements on the product
      // list and exactly one on a product's detail page. Demanding .first inside
      // item_detail_page.py demanded something the page does not need, and it cost
      // three rejections and a repair round that drifted further from a working
      // reply. The file name maps to the capture name by convention
      // (models/item_detail_page.py -> item_detail); the global set is the
      // fallback when no such capture exists.
      const pageName = /^models\/(.+)_page\.py$/.exec(rel)?.[1];
      const scoped = (pageName && multiMatchByPage.get(pageName)) || multiMatch;
      for (const m of content.matchAll(/self\.(\w+)\s*=\s*page\.locator\(\s*(['"])(.*?)\2\s*\)(.*)$/gm)) {
        const [, attr, , selector, tail] = m;
        if (!scoped.has(selector!)) continue;
        if (/\.(first|last|nth\()/.test(tail ?? '')) continue;
        const singular = new RegExp(
          `expect\\(\\s*self\\.${attr}\\s*\\)\\s*\\.\\s*(to_be_visible|to_contain_text|to_have_text|to_have_value)`,
        );
        if (singular.test(content)) {
          errors.push(
            `${rel}: self.${attr} uses ${selector}, which matches several elements on the page, ` +
            'and is then asserted on as if it were one. Chain .first (or .nth(i)) where it is ' +
            'defined, or assert to_have_count instead.',
          );
        }
      }
    }

    // Belt and braces: append-only makes losing or altering a member impossible,
    // but the check is cheap and it is what caught the problem in the first place.
    const before = existing.get(rel);
    if (!before) continue;
    const wasThere = memberBodies(before);
    const nowThere = memberBodies(content);
    const lost = [...wasThere.keys()].filter(name => !nowThere.has(name));
    if (lost.length) {
      errors.push(`${rel}: the merge would drop ${lost.join(', ')} — other tests call those.`);
    }
    for (const [name, body] of wasThere) {
      const after = nowThere.get(name);
      if (after === undefined) continue;
      if (name === '__init__') {
        // __init__ is the one body that MUST change when a locator is added, so
        // here the rule is "nothing removed" rather than "nothing changed".
        const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean);
        const dropped = lines(body).filter(l => !lines(after).includes(l));
        if (dropped.length) {
          errors.push(
            `${rel}: __init__ would lose ${dropped.length} existing line(s), starting with ` +
            `"${dropped[0]}". Add locators alongside the existing ones, never in place of them.`,
          );
        }
        continue;
      }
      if (after !== body) {
        errors.push(
          `${rel}: the body of the existing method ${name}() would change. Other tests rely on ` +
          'exactly what it does today; leave it alone and add new methods instead.',
        );
      }
    }
  }

  const testFiles = [...resulting].filter(([rel]) => /^test_/.test(rel));
  if (testFiles.length !== 1) {
    errors.push(`Expected exactly one test file named "${testModule}", found ${testFiles.length}.`);
  } else if (testFiles[0]![0] !== testModule) {
    errors.push(`The test file must be named "${testModule}", got "${testFiles[0]![0]}".`);
  }

  const testSource = testFiles.map(([, content]) => content).join('\n');
  for (const t of plan.tests) {
    const signature = new RegExp(`def\\s+${t.name}\\s*\\(\\s*(app|guest)\\s*:`);
    if (!signature.test(testSource)) {
      errors.push(`Missing test function: def ${t.name}(app: Page) -> None (or guest), as named in the plan.`);
    }
  }
  if (/\.locator\(/.test(testSource)) {
    errors.push('The test file calls page.locator(...) directly. Locators belong in page objects.');
  }
  // The fixture may only be handed to a constructor. This is what catches an
  // invented Playwright API: `app.expect_to_have_url(...)` compiles perfectly and
  // dies at runtime with AttributeError, so syntax checking alone never sees it.
  for (const m of testSource.matchAll(/\b(app|guest)\.(\w+)/g)) {
    errors.push(
      `The test file calls ${m[1]}.${m[2]}(...). The fixture may only be passed to a page-object ` +
      `constructor, e.g. CartPage(${m[1]}). Move ${m[2]} into a page-object method — and use a real ` +
      'Playwright API there, not an invented one.',
    );
  }
  if (/\bexpect\s*\(/.test(testSource)) {
    errors.push('The test file calls expect(...) directly. Assertions belong in page-object methods.');
  }

  // Every page-object method a test calls must actually exist. Caught a test
  // calling cart.remove_bike_light() that the model never added — an
  // AttributeError at runtime, invisible to the compiler and to every other gate.
  // Cheap to check statically: the bindings and the call sites are both right here.
  const classSource = new Map<string, string>();
  for (const [rel, content] of [...existing, ...resulting]) {
    const cls = /class\s+([A-Z]\w*Page)\b/.exec(content)?.[1];
    if (cls) classSource.set(cls, content);
  }
  const bindings = new Map<string, string>();
  for (const m of testSource.matchAll(/(\w+)\s*=\s*([A-Z]\w*Page)\s*\(\s*(?:app|guest)\s*\)/g)) {
    bindings.set(m[1]!, m[2]!);
  }
  for (const m of testSource.matchAll(new RegExp(String.raw`\b(\w+)\.(\w+)\s*\(([^)]*)\)`, "g"))) {
    const [, obj, method, argText] = m as unknown as [string, string, string, string];
    const cls = bindings.get(obj);
    if (!cls) continue;
    const source = classSource.get(cls);
    if (!source) continue;
    if (!memberBodies(source).has(method)) {
      errors.push(
        `The test calls ${obj}.${method}(), but ${cls} has no such method. Either use one of its ` +
        `existing methods or add ${method}() to that page object in this same reply.`,
      );
      continue;
    }
    // The method exists — but does it take what the test passes it?
    //
    // Checking existence alone let a reply through that called an existing
    // expect_url() with a URL argument when it takes none: every gate passed,
    // the files were written, and pytest died on a TypeError. A signature is
    // part of an interface, and comparing argument counts is arithmetic —
    // exactly the kind of error that should never cost a model request.
    const sig = signatureOf(source, method);
    const given = argText.trim() ? splitArgs(argText).length : 0;
    if (sig && (given < sig.required || given > sig.accepted)) {
      const wants = sig.required === sig.accepted
        ? `${sig.required}`
        : `${sig.required}-${sig.accepted}`;
      errors.push(
        `The test calls ${obj}.${method}() with ${given} argument(s), but ${cls}.${method}() takes ` +
        `${wants}. Match the existing signature, or give the new method the parameters the test needs.`,
      );
    }
    // Types too, not only counts. A str parameter given a bare number is the
    // failure this suite actually hit: expect_badge_count(2) reached
    // to_contain_text and Playwright refused it. Only literal arguments are
    // judged — a variable's type is not knowable from the call site, and a gate
    // that guesses is worse than one that stays quiet.
    const annotated = annotationsOf(source, method);
    if (annotated) {
      const args = argText.trim() ? splitArgs(argText).map(a => a.trim()) : [];
      args.forEach((arg, at) => {
        const want = annotated[at];
        if (!want) return;
        const isNumber = /^-?[0-9]+(\.[0-9]+)?$/.test(arg);
        const isString = /^(['"]).*$/.test(arg) || /^[fr](['"]).*$/.test(arg);
        if (want === 'str' && isNumber) {
          errors.push(
            `The test passes ${arg} to ${cls}.${method}(), whose parameter is typed str. ` +
            `Quote it ("${arg}") — Playwright's text assertions reject a number.`,
          );
        } else if ((want === 'int' || want === 'float') && isString) {
          errors.push(
            `The test passes ${arg} to ${cls}.${method}(), whose parameter is typed ${want}. ` +
            'Pass a number, not a string.',
          );
        }
      });
    }
  }
  // Every goto the plan asks for must appear somewhere the test can reach.
  //
  // Two of three replies silently dropped the plan's opening `goto /account`, and
  // one of them PASSED when run on its own — the login flow happens to land on
  // /account, so the missing navigation was invisible until the full suite ran and
  // a previous test had moved the shared page elsewhere. A test that passes for the
  // wrong reason is the most expensive kind of green, and this is checkable: the
  // plan names the path.
  //
  // The search covers the files being written plus the page objects the test binds
  // to, which is every place one hop from the test that could navigate.
  const reachable = [
    ...resulting.values(),
    ...[...bindings.values()].map(cls => classSource.get(cls) ?? ''),
  ].join('\n');
  const wantedPaths = new Set(
    plan.tests.flatMap(t => t.steps)
      .filter(s => s.action === 'goto' && typeof s.value === 'string')
      .map(s => String(s.value)),
  );
  for (const wanted of wantedPaths) {
    if (!reachable.includes(`goto("${wanted}"`) && !reachable.includes(`goto('${wanted}'`)) {
      errors.push(
        `The plan opens with goto("${wanted}") but nothing in the test or the page ` +
        `objects it uses navigates there. Add the navigation — a page object method ` +
        `such as open() is the usual place — or the test only passes when it happens ` +
        'to run while the browser is already on that page.',
      );
    }
  }
  // Assigning the result of a page-object method that returns None.
  //
  // `checkout = cart.click_checkout()` reads naturally and is wrong: the method
  // returns None, so the next line dies with AttributeError on NoneType. The
  // index lists parameters, and a return type is just as much part of a signature
  // - the fourth failure this session caused by showing a model half an interface.
  for (const m of testSource.matchAll(new RegExp(String.raw`^\s*(\w+)\s*=\s*(\w+)\.(\w+)\s*\(`, 'gm'))) {
    const [, , obj, method] = m as unknown as [string, string, string, string];
    const cls = bindings.get(obj);
    if (!cls) continue;
    const source = classSource.get(cls);
    if (!source || !memberBodies(source).has(method)) continue;
    if (new RegExp(String.raw`def\s+` + method + String.raw`\s*\([^)]*\)\s*->\s*None`).test(source)) {
      errors.push(
        `The test assigns the result of ${obj}.${method}(), which returns None. ` +
        'Call it as a statement and build the next page object from the fixture.',
      );
    }
  }
  // Every page object the test imports has to exist.
  //
  // A reply imported .models.sign_in_page — a page object from the OTHER site's
  // suite. It passed every gate and py_compile, because compiling checks syntax
  // and not names, and then pytest could not even collect the file:
  // ModuleNotFoundError. An import is a promise about the filesystem and the
  // filesystem is right here.
  // The framework import, which is one module and one spelling.
  //
  // A reply wrote `from playwright.sync import Page`. It is one character from
  // correct, py_compile accepts it because compiling does not resolve imports,
  // and pytest then cannot collect the file at all — taking the other eighteen
  // tests in the suite down with it, because a collection error stops the run.
  for (const m of testSource.matchAll(new RegExp(String.raw`^from\s+(playwright[\w.]*)\s+import`, 'gm'))) {
    if (m[1] === 'playwright.sync_api') continue;
    errors.push(
      `The test imports from ${m[1]}, which does not exist. The module is ` +
      'playwright.sync_api.',
    );
  }

  const available = new Set<string>([...existing.keys(), ...resulting.keys()]);
  for (const m of testSource.matchAll(new RegExp(String.raw`from\s+\.models\.(\w+)\s+import`, 'gm'))) {
    const rel = `models/${m[1]}.py`;
    if (available.has(rel)) continue;
    errors.push(
      `The test imports ${rel}, which does not exist and is not in this reply. ` +
      `Import only page objects the suite has, or emit that file too.`,
    );
  }
  const loggedOut = plan.tests.filter(t => (t.preconditions ?? []).some(p => /logged out|signed out/i.test(p)));
  for (const t of loggedOut) {
    if (!new RegExp(`def\\s+${t.name}\\s*\\(\\s*guest\\s*:`).test(testSource)) {
      errors.push(`${t.name} has a "logged out" precondition, so it must take the guest fixture, not app.`);
    }
  }

  return errors;
}

/** The blocks a repair needs to see: the test file always, plus any page object an
 *  error names.
 *
 *  Sending the whole previous reply made a repair larger than the generation it
 *  was repairing, and on a congested tier that is the request that gets refused
 *  (16.5k refused, 8.8k served). But sending ONLY the files named in errors cost
 *  more than it saved: no error mentioned the test file, so it was omitted, and
 *  the model dutifully re-sent a test file with all three tests deleted. The test
 *  file is never optional — it is the one artefact that must come back whole. */
/**
 * The previous reply, in full, with the problem files marked.
 *
 * In full, deliberately. An earlier version sent only the blocks an error named
 * plus the test file, to keep the repair prompt small. Twice that turned one
 * problem into several: the model returned exactly the blocks it had been shown
 * and everything else it had written the round before — three whole page objects
 * one time, all the tests another — simply vanished from the answer, because a
 * reply is judged as a whole.
 *
 * The trade was never worth it either. This repair prompt is under 5k against a
 * budget of roughly 11k, so the omission bought nothing and cost a round. A
 * repair means "here is your answer, here is what is wrong with it, return it
 * corrected" — and that requires the answer.
 */
function offendingBlocks(blocks: GeneratedFile[], errors: string[]): string {
  return blocks
    .map(b => {
      const rel = norm(b.relPath);
      const flagged = errors.some(e => e.includes(rel));
      const marker = `${b.kind === 'add' ? ADD_MARKER : FILE_MARKER}${rel} ===`;
      return flagged
        ? `${marker}   <-- problems reported in this file
${b.content}`
        : `${marker}
${b.content}`;
    })
    .join('\n');
}

/**
 * A whole-file block for a page object that already exists, rewritten as an
 * addition of only what is new.
 *
 * Models send a complete file for an existing page object routinely, and the old
 * response was to reject the reply and spend another request asking for a
 * different marker. Deriving the addition is both cheaper and *safer* than the
 * whole file would have been: a whole file replaces, so any member the reply
 * forgot would be deleted — the original catastrophe this contract exists to
 * prevent — whereas an addition can only ever add. A re-sent member whose body
 * differs is left in, so the "existing method would change" gate still sees it.
 */
function additionFromWholeFile(existing: string, whole: string): string {
  const before = memberBodies(existing);
  const lines: string[] = [];

  for (const m of whole.matchAll(LOCATOR_WITH_SELECTOR)) {
    const line = `self.${m[1]} = page.locator(${m[2]}${m[3]}${m[2]})`;
    if (!existing.includes(`self.${m[1]} = page.locator(`)) lines.push(`        ${line}`);
  }

  const src = whole.split(/\r?\n/);
  let current: string | undefined;
  let chunk: string[] = [];
  const flush = () => {
    if (!current || current === '__init__') return;
    const body = chunk.slice(1).map(l => l.trim()).join('\n').trim();
    // Every member that already exists is dropped, whether or not its body
    // matches. The model was not asked to modify them, and an addition can only
    // insert — that is the property the whole contract rests on. Keeping a
    // differing body would only surface as an "existing method would change"
    // error, which is noise when the reply was a whole file: re-deriving open()
    // is what writing a whole file means, not a request to change it.
    if (!before.has(current)) lines.push(...chunk, '');
  };
  for (const line of src) {
    const def = /^\s*def\s+(\w+)/.exec(line);
    if (def) { flush(); current = def[1]!; chunk = [line]; continue; }
    if (current) chunk.push(line);
  }
  flush();
  return lines.join('\n');
}

/**
 * Rewrite blocks into the only shapes the rest of the pipeline accepts.
 *
 * Explicit and up front, because doing it as a side effect inside the validator
 * cost a page object six methods. validateFiles() mutated the block it was given,
 * which worked for the generate path and silently did nothing for --apply-last,
 * where the reply is re-parsed from disk: the whole file was then written as a
 * whole file and every member the reply had omitted was deleted. A transformation
 * that both validation and writing depend on cannot live inside one of them.
 */
export function normalizeBlocks(files: GeneratedFile[], existing: Map<string, string>): GeneratedFile[] {
  return files.map(f => {
    const rel = norm(f.relPath);
    const before = existing.get(rel);
    if (f.kind === 'add' || !before || !rel.startsWith('models/')) return { ...f, relPath: rel };
    return { relPath: rel, kind: 'add', content: additionFromWholeFile(before, f.content) };
  });
}

/** What will be written to disk once every addition is merged. */
export function resolveFiles(files: GeneratedFile[], existing: Map<string, string>): GeneratedFile[] {
  return files.map(f => {
    const rel = norm(f.relPath);
    const before = existing.get(rel);
    return f.kind === 'add' && before
      ? { relPath: rel, content: mergeAddition(before, f.content) }
      : { relPath: rel, content: f.content };
  });
}

/** Compile with the real interpreter — the only trustworthy syntax check. */
function compileCheck(files: GeneratedFile[], feature: string): string[] {
  const stage = path.join(configuredPath('context'), 'pending', slug(feature));
  rmSync(stage, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(stage, f.relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.content, 'utf8');
  }
  const python = process.env.PYTEST_PYTHON || 'python';
  const errors: string[] = [];
  for (const f of files) {
    try {
      execFileSync(python, ['-m', 'py_compile', path.join(stage, f.relPath)], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const out = String((err as { stderr?: Buffer }).stderr ?? err)
        .replace(new RegExp(stage.replace(/\\/g, '\\\\'), 'g'), '');
      errors.push(`${f.relPath}: Python cannot compile this file: ${out.trim().slice(0, 300)}`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const planPath = path.isAbsolute(args.plan) ? args.plan : fromRoot(args.plan);
  if (!existsSync(planPath)) die(`No plan at ${args.plan}`);
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as TestPlan;
  const site = loadSite(plan.site);

  const captures = loadCaptures(plan.site);
  // Per selector, the matches from the SINGLE capture where it occurs most —
  // not every match across every capture.
  //
  // Summing across captures was a real defect with real consequences. A cart
  // badge that appears once on each of three pages counted as "3 elements", so
  // the prompt ordered .first on a selector that is unique per page and the gate
  // then rejected the reply for not chaining it. Two models — a 9B and a 550B —
  // were failed for the same non-problem. When models of wildly different
  // capability make the identical "mistake", suspect the judge before the
  // judged: a guardrail can manufacture the violation it then reports.
  const perCapture = new Map<string, CapturedElement[][]>();
  for (const c of captures) {
    const here = new Map<string, CapturedElement[]>();
    for (const el of c.elements) {
      for (const sel of selectorsFor(el, c.unstable)) {
        here.set(sel, [...(here.get(sel) ?? []), el]);
      }
    }
    for (const [sel, els] of here) {
      perCapture.set(sel, [...(perCapture.get(sel) ?? []), els]);
    }
  }
  const bySelector = new Map<string, CapturedElement[]>(
    [...perCapture].map(([sel, groups]) => [
      sel,
      groups.reduce((most, g) => (g.length > most.length ? g : most)),
    ]),
  );

  const testModule = `test_${slug(plan.feature)}.py`;
  const suiteDir = fromRoot(site.testsDir);
  const testFilePath = path.join(suiteDir, testModule);
  // --validate-only writes nothing, so an existing file is not in its way.
  if (existsSync(testFilePath) && !args.force && !args.validateOnly && !args.applyLast) {
    die(`${path.relative(fromRoot(), testFilePath)} already exists. Re-run with --force to overwrite.`);
  }

  step(`Generating ${bold(testModule)} from ${bold(path.basename(planPath))} ${dim(`(${plan.tests.length} test(s))`)}`);

  // ALL existing page objects, as interfaces. Filtering them by the plan's page
  // names looked tidier and cost a repair round: a capture called
  // `cart_two_items` describes the same screen as `cart_page.py`, so the model
  // was never shown that the file existed and dutifully sent it as a new one.
  // Interfaces are small enough that guessing which are relevant is not worth the
  // risk of hiding one.
  // Does the suite already have these tests?
  //
  // Three of the five "new" tests in the remaining checkout plans turned out to
  // exist already, under the same names, green, in other files — the plans had
  // been written on different days and overlapped heavily. Paying a model to
  // regenerate a passing test is the kind of waste nothing reports: the run looks
  // like progress. So the suite is checked first, and a plan with nothing new in
  // it does not get to spend a request.
  const existingTestNames = new Map<string, string>();
  for (const file of readdirSync(suiteDir).filter(f => /^test_.*[.]py$/.test(f))) {
    if (file === testModule) continue;
    const body = readFileSync(path.join(suiteDir, file), 'utf8');
    for (const m of body.matchAll(new RegExp(String.raw`^def (test_\\w+)`, 'gm'))) {
      existingTestNames.set(m[1]!, file);
    }
  }
  const duplicates = plan.tests
    .map(t => [t.name, existingTestNames.get(t.name)] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]));
  if (duplicates.length) {
    warn(`${duplicates.length} of ${plan.tests.length} test(s) in this plan already exist elsewhere:`);
    for (const [name, file] of duplicates) info(dim(`    ${name}  ->  already in ${file}`));
    if (duplicates.length === plan.tests.length) {
      die('Every test in this plan is already in the suite. Nothing to generate.');
    }
  }

  const multiMatch = multiMatchSelectors(plan, bySelector);
  // The same computation, kept per capture page, so a page object can be judged
  // against the page it belongs to.
  const multiMatchByPage = new Map<string, Set<string>>();
  for (const c of captures) {
    const here = new Map<string, CapturedElement[]>();
    for (const el of c.elements) {
      for (const sel of selectorsFor(el, c.unstable)) {
        here.set(sel, [...(here.get(sel) ?? []), el]);
      }
    }
    multiMatchByPage.set(c.page, multiMatchSelectors(plan, here));
  }
  if (multiMatch.size) {
    info(dim(`${multiMatch.size} selector(s) match several elements — singular assertions on them will be rejected`));
  }

  const existing = existingPageObjects(suiteDir);
  if (existing.size) {
    info(dim(`${existing.size} existing page object(s), shown as interfaces to add to`));
  }

  const system = generatorSystem();
  const firstPrompt = generatorUser({
    siteName: site.name,
    feature: plan.feature,
    planJson: slimPlan(plan),
    selectorNotes: selectorNotes(plan, bySelector),
    reference: referenceBlocks(),
    moduleName: testModule,
    existing: existing.size ? pageObjectIndex(existing, planSelectorSet(plan), planPageSet(plan)) : undefined,
  });
  let prompt = firstPrompt;
  info(dim(`prompt: ${(prompt.length / 1000).toFixed(1)}k chars`));

  let accepted: GeneratedFile[] | undefined;
  let model = '';
  let repairs = 0;

  if (args.applyLast) {
    const judge = (text: string) => {
      const b = normalizeBlocks(parseFileBlocks(text), existing);
      const e = [...validateFiles(b, plan, testModule, existing, multiMatch, multiMatchByPage)];
      return e.length === 0 ? compileCheck(resolveFiles(b, existing), plan.feature) : e;
    };
    const previous = bestReplyFor(plan.feature, judge, planPath);
    if (!previous) die(`No saved reply for "${plan.feature}".`);
    if (previous.errors.length) {
      fail(`${previous.file} still has ${previous.errors.length} problem(s) — not applying:`);
      for (const e of previous.errors) info(dim(`  - ${e.slice(0, 160)}`));
      process.exit(1);
    }
    ok(`${previous.file} passes the current gates`);
    accepted = resolveFiles(normalizeBlocks(parseFileBlocks(previous.text), existing), existing);
    model = `${previous.file.split('.').slice(-2, -1)[0]} (saved reply, no new request)`;
  }

  if (args.validateOnly) {
    const judge = (text: string) => {
      const b = normalizeBlocks(parseFileBlocks(text), existing);
      const e = [...validateFiles(b, plan, testModule, existing, multiMatch, multiMatchByPage)];
      return e.length === 0 ? compileCheck(resolveFiles(b, existing), plan.feature) : e;
    };
    const saved = savedRepliesFor(plan.feature, judge, planPath);
    if (!saved.length) die(`No saved replies for "${plan.feature}".`);
    for (const r of saved) {
      const label = `${r.errors.length} problem(s)`;
      if (r.errors.length === 0) ok(`${r.file} — passes`);
      else warn(`${r.file} — ${label}`);
      for (const e of r.errors) info(dim(`    - ${e.slice(0, 150)}`));
    }
    process.exit(0);
  }

  if (args.repairFromLast) {
    const judge = (text: string) => {
      const b = normalizeBlocks(parseFileBlocks(text), existing);
      const e = [...validateFiles(b, plan, testModule, existing, multiMatch, multiMatchByPage)];
      return e.length === 0 ? compileCheck(resolveFiles(b, existing), plan.feature) : e;
    };
    const previous = bestReplyFor(plan.feature, judge, planPath);
    if (!previous) die(`No saved reply for "${plan.feature}" to repair. Run a normal generation first.`);
    const blocks = normalizeBlocks(parseFileBlocks(previous.text), existing);
    const errors = previous.errors;
    if (errors.length === 0) {
      warn(`the saved reply (${previous.file}) already passes — nothing to repair. Re-run without --repair-from-last to write it.`);
      process.exit(0);
    }
    info(dim(`repairing ${previous.file} — ${errors.length} problem(s) to fix`));
    prompt = generatorRepair({
      planJson: slimPlan(plan),
      selectorNotes: selectorNotes(plan, bySelector),
      moduleName: testModule,
      offending: offendingBlocks(blocks, errors),
      required: blocks.map(b => `${b.kind === 'add' ? ADD_MARKER : FILE_MARKER}${norm(b.relPath)} ===`),
      errors,
      // Only when a complaint is about a file that already exists on disk.
      existing: errors.some(e => [...existing.keys()].some(rel => e.includes(rel)))
        ? pageObjectIndex(existing, planSelectorSet(plan), planPageSet(plan))
        : undefined,
    });
    info(dim(`repair prompt: ${(prompt.length / 1000).toFixed(1)}k chars`));
    repairs = 1;
  }

  const maxRepairs = args.once ? 0 : MAX_REPAIRS;
  // Nothing to ask when a saved reply has already been accepted. Without this
  // guard --apply-last fell straight through into the request loop and spent
  // three of the day's requests re-asking a question it already had the answer
  // to. An early-return path has to actually return.
  for (let attempt = 0; !accepted && attempt <= maxRepairs; attempt++) {
    const res = await askModel({
      role: 'generator',
      system,
      prompt,
      label: `gen-${slug(plan.feature)}${attempt ? `-repair${attempt}` : ''}`,
      once: args.once,
      model: args.model,
    });
    model = res.model;

    const blocks = normalizeBlocks(parseFileBlocks(res.text), existing);
    info(dim(`${blocks.length} block(s): ${blocks.map(b => `${b.kind === 'add' ? '+' : ''}${b.relPath}`).join(', ') || 'none'}`));

    const errors = [...validateFiles(blocks, plan, testModule, existing, multiMatch, multiMatchByPage)];
    const merged = resolveFiles(blocks, existing);
    if (errors.length === 0) errors.push(...compileCheck(merged, plan.feature));

    if (errors.length === 0) {
      accepted = merged;
      break;
    }

    warn(`${errors.length} problem(s)${attempt < maxRepairs ? ' — asking the model to fix them' : ''}`);
    for (const e of errors.slice(0, 10)) info(dim(`- ${e.slice(0, 220)}`));
    if (errors.length > 10) info(dim(`  ...and ${errors.length - 10} more`));

    if (attempt === maxRepairs) {
      fail(args.once
        ? 'The endpoint SERVED the request; the reply did not pass the gates. Re-run without --once for a repair round.'
        : `Still invalid after ${maxRepairs} repair attempt(s) — nothing written to the suite.`);
      info(`Raw replies: ${path.relative(fromRoot(), path.join(configuredPath('context'), 'replies'))}`);
      process.exit(1);
    }
    prompt = generatorRepair({
      planJson: slimPlan(plan),
      selectorNotes: selectorNotes(plan, bySelector),
      moduleName: testModule,
      offending: offendingBlocks(blocks, errors),
      errors,
      // Only when a complaint is about a file that already exists on disk.
      existing: errors.some(e => [...existing.keys()].some(rel => e.includes(rel)))
        ? pageObjectIndex(existing, planSelectorSet(plan), planPageSet(plan))
        : undefined,
    });
    repairs++;
  }

  if (!accepted) die('Generator produced nothing.');

  for (const f of accepted) {
    const target = path.join(suiteDir, f.relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    const grew = existing.has(norm(f.relPath));
    writeFileSync(target, f.content, 'utf8');
    ok(`${path.relative(fromRoot(), target)} ${dim(`(${f.content.split('\n').length} lines${grew ? ', extended' : ''})`)}`);
  }

  // Page objects live in a package; without this, the relative import fails.
  const initFile = path.join(suiteDir, 'models', '__init__.py');
  if (!existsSync(initFile)) {
    mkdirSync(path.dirname(initFile), { recursive: true });
    writeFileSync(initFile, '', 'utf8');
  }

  ok(bold(`generated by ${model}${repairs ? ` after ${repairs} repair round(s)` : ' on the first attempt'}`));
  info(`Next: npm run test -- --site ${site.id} --file ${testModule}`);
}

// Only run as a CLI when invoked directly — importing this module (to test the
// gates, say) must not start a generation.
if (process.argv[1] && path.basename(process.argv[1]).startsWith('run_generator')) {
  main().catch(err => die(err instanceof Error ? err.message : String(err)));
}
