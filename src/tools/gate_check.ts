// Do the validation gates actually fire?
//
//   npm run gates
//
// This exists because of a real incident, not out of tidiness. A shell edit
// meant to insert the two characters `\b` into a regex inserted a literal
// backspace byte (0x08) instead. The regex became /<BS>expect\s*\(/, which
// matches nothing — so two gates were silently dead for a day. Nothing looked
// wrong: a gate that cannot fire produces exactly the same output as a gate that
// passes. The only defence is to feed each gate something it must reject.
//
// Add a case here whenever you add a gate.

import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { validateFiles, mergeAddition, memberBodies, resolveFiles, normalizeBlocks } from '../generator/run_generator.js';
import { validatePlan, type TestPlan } from '../planner/plan_schema.js';
import type { Capture } from '../lib/context.js';
import { ok, fail, info, step, bold, dim } from '../lib/log.js';

let failures = 0;

function expectRejected(name: string, errors: string[], mustMention: string): void {
  const hit = errors.find(e => e.toLowerCase().includes(mustMention.toLowerCase()));
  if (hit) {
    ok(`${name} ${dim('→ rejected')}`);
  } else {
    fail(`${name} — NOT rejected (gate is dead or its message changed)`);
    info(dim(errors.length ? `got instead: ${errors[0]!.slice(0, 120)}` : 'no errors at all'));
    failures++;
  }
}

function expectAccepted(name: string, errors: string[]): void {
  if (errors.length === 0) ok(`${name} ${dim('→ accepted')}`);
  else {
    fail(`${name} — rejected, but should be fine`);
    for (const e of errors.slice(0, 3)) info(dim(e.slice(0, 140)));
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Planner gates
// ---------------------------------------------------------------------------
step(bold('Plan validation'));

const capture: Capture = {
  page: 'form',
  url: 'https://example.test/form',
  aria: '',
  unstable: [/item-[A-Z0-9]{20,}/],
  elements: [
    { tag: 'input', dataTest: 'name' },
    { tag: 'button', dataTest: 'submit' },
    { tag: 'div', dataTest: 'error', text: 'Name is required' },
    { tag: 'a', dataTest: 'item-01ABCDEFGHJKMNPQRSTVWX' },
  ],
};

const goodTest = {
  id: 'a',
  name: 'test_submitting_empty_form_shows_error',
  title: 'Submitting the form empty shows the error',
  pages: ['form'],
  steps: [
    { action: 'click' as const, selector: '[data-test="submit"]' },
    { action: 'expect_visible' as const, selector: '[data-test="error"]' },
  ],
  expected: ['an error is shown'],
};

const plan = (tests: unknown[]): TestPlan => ({ site: 's', feature: 'f', tests: tests as never });

expectAccepted('a sound plan', validatePlan(plan([goodTest]), [capture], 'f'));

expectRejected('invented selector',
  validatePlan(plan([{ ...goodTest, steps: [
    { action: 'click', selector: '[data-test="submit"]:nth-of-type(2)' },
    { action: 'expect_visible', selector: '[data-test="error"]' },
  ] }]), [capture], 'f'),
  'never observed');

expectRejected('data-generated selector (ULID)',
  validatePlan(plan([{ ...goodTest, steps: [
    { action: 'click', selector: '[data-test="item-01ABCDEFGHJKMNPQRSTVWX"]' },
    { action: 'expect_visible', selector: '[data-test="error"]' },
  ] }]), [capture], 'f'),
  'never observed');

expectRejected('assertion that cannot fail',
  validatePlan(plan([{ ...goodTest, steps: [
    { action: 'click', selector: '[data-test="submit"]' },
    { action: 'expect_url', value: '/' },
  ] }]), [capture], 'f'),
  'asserts nothing');

expectRejected('no assertion at all',
  validatePlan(plan([{ ...goodTest, steps: [{ action: 'click', selector: '[data-test="submit"]' }] }]),
    [capture], 'f'),
  'no expect_');

expectRejected('two tests asserting the same thing',
  validatePlan(plan([goodTest, { ...goodTest, id: 'b', name: 'test_something_else' }]), [capture], 'f'),
  'same things');

// ---------------------------------------------------------------------------
// Generator gates
// ---------------------------------------------------------------------------
console.log();
step(bold('Generated-code validation'));

const genPlan = plan([{
  ...goodTest,
  name: 'test_a',
  steps: [
    { action: 'click', selector: '#go' },
    { action: 'expect_visible', selector: '#done' },
  ],
}]);

const pageObject = [
  'from playwright.sync_api import Page, expect',
  '',
  '',
  'class ThingPage:',
  '    def __init__(self, page: Page) -> None:',
  '        self.page = page',
  '        self.go = page.locator("#go")',
  '        self.done = page.locator("#done")',
  '',
  '    def click_go(self) -> None:',
  '        self.go.click()',
  '',
  '    def expect_done(self) -> None:',
  '        expect(self.done).to_be_visible()',
  '',
].join('\n');

const testFile = (body: string) => [
  'from playwright.sync_api import Page',
  '',
  'from .models.thing_page import ThingPage',
  '',
  '',
  'def test_a(app: Page) -> None:',
  '    """T."""',
  '    thing = ThingPage(app)',
  body,
  '',
].join('\n');

const soundFiles = [
  { relPath: 'models/thing_page.py', content: pageObject },
  { relPath: 'test_f.py', content: testFile('    thing.click_go()\n    thing.expect_done()') },
];

expectAccepted('sound generated files', validateFiles(soundFiles, genPlan, 'test_f.py', new Map()));

expectRejected('fixture used directly (invented API)',
  validateFiles([soundFiles[0]!, { relPath: 'test_f.py', content: testFile('    app.expect_to_have_url("/x")') }],
    genPlan, 'test_f.py', new Map()),
  'may only be passed');

expectRejected('expect() inside the test file',
  validateFiles([soundFiles[0]!, { relPath: 'test_f.py', content: testFile('    expect(app).to_have_url("/x")') }],
    genPlan, 'test_f.py', new Map()),
  'expect(...) directly');

expectRejected('locator not in the plan',
  validateFiles([
    { relPath: 'models/thing_page.py', content: pageObject.replace('"#done"', '"#invented"') },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', new Map()),
  'neither in the plan');

expectRejected('locator in a test file',
  validateFiles([soundFiles[0]!, { relPath: 'test_f.py', content: testFile('    app.locator("#go").click()') }],
    genPlan, 'test_f.py', new Map()),
  'locator');

expectRejected('sleep added',
  validateFiles([
    { relPath: 'models/thing_page.py', content: pageObject.replace('        self.go.click()', '        time.sleep(2)\n        self.go.click()') },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', new Map()),
  'remove the sleep');

const onDisk = new Map([['models/thing_page.py', pageObject]]);

// Append-only contract: an existing page object may only be added to. A whole
// file for one is no longer rejected — it is rewritten as an addition of what is
// new, which is cheaper than another request and strictly safer than the file
// would have been. The invariant below is what makes that safe.
// Through normalizeBlocks, which is how every caller in the pipeline reaches
// validateFiles — the conversion is a step, not a side effect.
expectAccepted('existing page object sent as a whole file → converted to an addition',
  validateFiles(normalizeBlocks([
    { relPath: 'models/thing_page.py', content: pageObject },
    soundFiles[1]!,
  ], onDisk), genPlan, 'test_f.py', onDisk));

expectRejected('addition redefines an existing method',
  validateFiles([
    {
      relPath: 'models/thing_page.py',
      kind: 'add',
      content: '    def expect_done(self) -> None:\n        expect(self.done).to_have_count(0)\n',
    },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', onDisk),
  'already exist');

expectRejected('addition to a page object that does not exist',
  validateFiles([
    { relPath: 'models/other_page.py', kind: 'add', content: '    def go(self) -> None:\n        pass\n' },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', onDisk),
  'no such page object');

expectAccepted('addition of a genuinely new method',
  validateFiles([
    {
      relPath: 'models/thing_page.py',
      kind: 'add',
      content: '    def expect_done_visible_twice(self) -> None:\n        expect(self.done).to_be_visible()\n',
    },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', onDisk));

// __init__ is the one body that must be allowed to grow.
expectAccepted('addition of a new locator (grows __init__)',
  validateFiles([
    {
      relPath: 'models/thing_page.py',
      kind: 'add',
      content: '        self.also_done = page.locator("#done")\n\n    def expect_also(self) -> None:\n        expect(self.also_done).to_be_visible()\n',
    },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', onDisk));

// The invariant that replaced the whole-file rejection, and a stronger one: a
// rewrite that OMITS an existing locator cannot delete it, because the block is
// converted to an addition and an addition can only ever insert. Asserted on the
// merged output rather than the error list - the point is what lands on disk.
{
  const dropping = {
    relPath: 'models/thing_page.py',
    content: pageObject.replace('        self.done = page.locator("#done")' + String.fromCharCode(10), ''),
  };
  const normalised = normalizeBlocks([dropping, soundFiles[1]!], onDisk);
  const errs = validateFiles(normalised, genPlan, 'test_f.py', onDisk);
  const merged = resolveFiles(normalised, onDisk)[0]!.content;
  if (errs.length === 0 && merged.includes('self.done = page.locator')) {
    ok('a rewrite that omits a locator cannot delete it - the merge still has it');
  } else {
    fail(`omitted locator was lost, or the reply was rejected (${errs.length} error(s))`);
    failures++;
  }
}

// Playwright strict mode: a singular assertion on a multi-match locator.
expectRejected('singular assertion on a locator matching many elements',
  validateFiles([
    {
      relPath: 'models/thing_page.py',
      content: pageObject.replace('self.done = page.locator("#done")', 'self.done = page.locator("#done")'),
    },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', new Map(), new Set(['#done'])),
  'matches several elements');

expectAccepted('multi-match locator chained with .first',
  validateFiles([
    {
      relPath: 'models/thing_page.py',
      content: pageObject.replace('page.locator("#done")', 'page.locator("#done").first'),
    },
    soundFiles[1]!,
  ], genPlan, 'test_f.py', new Map(), new Set(['#done'])));

expectRejected('test calls a page-object method that does not exist',
  validateFiles([
    soundFiles[0]!,
    { relPath: 'test_f.py', content: testFile('    thing.click_go()\n    thing.expect_nonexistent()') },
  ], genPlan, 'test_f.py', new Map()),
  'has no such method');

expectAccepted('test calls a method the same reply adds',
  validateFiles([
    {
      relPath: 'models/thing_page.py',
      kind: 'add',
      content: '    def expect_freshly_added(self) -> None:\n        expect(self.done).to_be_visible()\n',
    },
    { relPath: 'test_f.py', content: testFile('    thing.click_go()\n    thing.expect_freshly_added()') },
  ], genPlan, 'test_f.py', onDisk));

// And the merge itself must land the new members in the right places.
console.log();
step(bold('Merging an addition'));
const merged = mergeAddition(
  pageObject,
  '        self.extra = page.locator("#done")\n\n    def click_extra(self) -> None:\n        self.extra.click()\n',
);
const mergedOk = memberBodies(merged);
if (mergedOk.has('expect_done') && mergedOk.has('click_extra')
  && /self\.extra = page\.locator/.test(merged)
  && merged.indexOf('self.extra') < merged.indexOf('def click_go')) {
  ok('locator lands in __init__, method lands on the class, nothing lost');
} else {
  fail('merge put things in the wrong place');
  console.log(merged);
  failures++;
}

// A guard against how these gates get broken, rather than against a bad reply.
//
// Twice now a shell-side edit has written a literal control byte into a source
// file where an escape was intended: 0x08 instead of the two characters that
// spell a word boundary. The regex then matches nothing, the gate it powers
// silently stops firing, and no editor, no diff and no `sed` output shows the
// difference - the byte is invisible. Once cost two dead gates; the second time
// cost an index that reported every file as irrelevant. So the suite now checks
// its own source for the bytes that should never appear in it.
console.log();
step(bold('Source hygiene'));
{
  const suspect = new Set([0x08, 0x0b, 0x0c]);
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const bytes = readFileSync(full);
      const at = bytes.findIndex(b => suspect.has(b));
      if (at >= 0) offenders.push(`${full} (byte 0x${bytes[at]!.toString(16)} at offset ${at})`);
    }
  };
  walk('src');
  if (offenders.length === 0) {
    ok('no stray control bytes in src/ - every escape is still an escape');
  } else {
    fail('control byte(s) in source, almost certainly a mangled escape:');
    for (const o of offenders) console.log(`    ${o}`);
    failures++;
  }
}

console.log();
if (failures === 0) {
  ok(bold('every gate fires'));
} else {
  fail(bold(`${failures} gate(s) are not doing their job`));
  process.exit(1);
}
