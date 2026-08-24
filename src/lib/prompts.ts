// All model-facing text lives here.
//
// Written for a small free model: explicit vocabulary, a worked example, and
// rules phrased as prohibitions with the correct alternative attached. Nothing
// in here names a specific site — every fact comes from the descriptor and the
// captures.

import type { SiteDescriptor } from '../sites/registry.js';
import type { Capture } from './context.js';
import { selectorCatalog } from './context.js';
import { STEP_ACTIONS } from '../planner/plan_schema.js';

export function plannerSystem(): string {
  return [
    'You are a senior QA engineer who designs UI regression tests.',
    '',
    'You will be given the accessibility tree and the observed selectors of a web',
    'application, and asked to plan tests for one feature. You reply with JSON only:',
    'no prose, no markdown fences, no commentary before or after.',
    '',
    'You design tests that a machine will execute literally. Every step must be',
    'something a browser can do, in the order a user would do it, using only the',
    'selectors you were shown. You never invent a selector, a URL or a label.',
  ].join('\n');
}

export interface PlannerPromptInput {
  site: SiteDescriptor;
  captures: Capture[];
  feature: string;
  maxTests: number;
  /** Extra operator guidance, e.g. "do not create data". */
  notes?: string;
}

/** Collapse long runs of near-identical nodes and cap the tree's length.
 *
 *  A form with a country dropdown captures 300+ accessibility lines, nearly all
 *  of them `- option "..."`. Sending them costs thousands of characters, teaches
 *  the model nothing, and pushes the request past what a free endpoint serves —
 *  so a run of the same node type is shown three deep with a count, and the tree
 *  is capped. The selector catalogue below is unaffected.
 *
 *  The cap started at 90 lines and came down to 40 the day the endpoints would
 *  not serve 13.1k. The tree is here to say what KIND of page this is; the
 *  catalogue is the authority on what can be addressed, and it is never trimmed. */
function trimAria(aria: string, maxLines = 40): string {
  const lines = aria.split('\n').filter(l => !l.startsWith('#'));
  const kind = (l: string) => (/^\s*- (\w+)/.exec(l)?.[1] ?? l.trim().slice(0, 12));

  const out: string[] = [];
  let run = 0;
  let previous = '';
  for (const line of lines) {
    const k = kind(line);
    run = k === previous ? run + 1 : 0;
    previous = k;
    if (run < 3) out.push(line);
    else if (run === 3) out.push(`  … more ${k} nodes of the same kind, omitted`);
  }

  return out.length > maxLines
    ? `${out.slice(0, maxLines).join('\n').trim()}\n  … tree truncated; the selector list below is complete`
    : out.join('\n').trim();
}

function pageSection(site: SiteDescriptor, c: Capture, shared: Set<string>): string {
  const descriptor = site.pages.find(p => p.name === c.page);
  const own = selectorCatalog(c)
    .split('\n')
    .filter(line => !shared.has(line.trim().split(/\s{2,}/)[0] ?? ''));
  // A page the descriptor gives no `path` was reached by clicking, and its URL is
  // an artifact of that route rather than an address. Advertising it invited
  // exactly one plan to open goto("/product/01M0MRXRTD5V08KC3NTDBNFSDG") — a ULID
  // this site already declares unstable for selectors, which would have worked
  // until the next reseed. Such a page is described by how it is reached instead.
  const reachable = Boolean(descriptor?.path);
  return [
    `### page: ${c.page}`,
    reachable
      ? `url: ${c.url}`
      : 'url: no stable path — this page is reached by navigating from another one, '
        + 'so never goto() it directly; click through as the note describes',
    descriptor?.note ? `purpose: ${descriptor.note}` : undefined,
    '',
    'accessibility tree:',
    trimAria(c.aria),
    '',
    shared.size
      ? 'selectors specific to this page (the shared ones above are available here too):'
      : 'selectors observed on this page (THE ONLY ONES YOU MAY USE for this page):',
    own.join('\n'),
    '',
  ].filter(Boolean).join('\n');
}

/** Selectors present on EVERY captured page — navigation, headers, footers.
 *
 *  Repeating them per page is what made a two-page planner prompt 18.1k
 *  characters: the site chrome was listed twice in full. Listed once, they stay
 *  legal everywhere and the per-page sections carry only what distinguishes them. */
function sharedSelectors(captures: Capture[]): Set<string> {
  if (captures.length < 2) return new Set();
  const perPage = captures.map(c => new Set(
    selectorCatalog(c).split('\n').map(l => l.trim().split(/\s{2,}/)[0] ?? '').filter(Boolean),
  ));
  const [first, ...rest] = perPage;
  return new Set([...first!].filter(sel => rest.every(s => s.has(sel))));
}

const EXAMPLE = `{
  "site": "example-site",
  "feature": "sign-in",
  "tests": [
    {
      "id": "signin_rejects_wrong_password",
      "name": "test_signin_rejects_wrong_password",
      "title": "Signing in with a wrong password shows an error and stays on the form",
      "pages": ["login"],
      "preconditions": ["logged out"],
      "steps": [
        { "action": "goto", "value": "/" },
        { "action": "fill", "selector": "#email", "value": "user@example.com" },
        { "action": "fill", "selector": "#password", "value": "definitely-wrong" },
        { "action": "click", "selector": "#submit" },
        { "action": "expect_visible", "selector": "[data-test=\\"error\\"]", "note": "error banner appears" },
        { "action": "expect_text", "selector": "[data-test=\\"error\\"]", "value": "do not match" },
        { "action": "expect_visible", "selector": "#submit", "note": "still on the form" }
      ],
      "expected": [
        "an error message naming the credential problem is displayed",
        "the user is not signed in and the form is still shown"
      ]
    }
  ]
}`;

export function plannerUser(input: PlannerPromptInput): string {
  const { site, captures, feature, maxTests, notes } = input;
  return [
    `## Application under test: ${site.name}`,
    `base URL: ${site.baseUrl}`,
    '',
    site.facts,
    '',
    ...(site.sampleData
      ? [
        '## Known-good field values (verified against the live application)',
        '',
        ...Object.entries(site.sampleData)
          .filter(([key]) => !key.startsWith('/'))
          .map(([key, value]) => `  ${key}: ${value}`),
        '',
      ]
      : []),
    '## Captured pages',
    '',
    ...(() => {
      const shared = sharedSelectors(captures);
      const preamble = shared.size ? [
        'These selectors appear on EVERY captured page — site chrome, navigation,',
        'headers. They are legal on any of the pages below, and are listed once here',
        'instead of being repeated in each section:',
        '',
        [...shared].map(s => `  ${s}`).join('\n'),
        '',
      ] : [];
      return [...preamble, captures.map(c => pageSection(site, c, shared)).join('\n')];
    })(),
    '## Your task',
    '',
    `Plan up to ${maxTests} regression tests for the feature: **${feature}**.`,
    notes ? `\nOperator guidance: ${notes}` : '',
    '',
    'Cover the main successful path first, then the failure and edge cases the',
    'captured pages actually support. Prefer few strong tests over many shallow',
    'ones: each test must be able to fail for exactly one reason.',
    '',
    '## Output format',
    '',
    'Reply with a single JSON object of this exact shape:',
    '',
    EXAMPLE,
    '',
    '## Rules',
    '',
    `1. "action" must be one of: ${STEP_ACTIONS.join(', ')}. Nothing else exists.`,
    '2. Every "selector" must be copied character-for-character from the selector',
    '   list of a page named in that test\'s "pages". Never invent or guess one.',
    '3. Prefer a [data-test="..."] selector when the element has one; it is more',
    '   stable than a class. Use #id when there is no data-test.',
    '4. "goto" takes a "value" that is a path starting with "/", never a full URL.',
    '4b. For any field that is NOT the subject of the test, use the value given in',
    '    "Known-good field values" below if one is listed. Plausible-looking data',
    '    is not the same as valid data: an invented phone number or password the',
    '    application rejects makes a correct assertion fail for a reason that has',
    '    nothing to do with the test.',
    '5. Every test needs at least one expect_* step. A test that asserts nothing',
    '   cannot fail and is worthless.',
    '6. "name" must be a snake_case pytest function name: test_<something>.',
    '7. Each test starts from a clean application state and, unless it is testing',
    '   the sign-in flow itself, from a logged-in session. Do not add steps to log',
    '   in or to reset state — the harness does both. For a test that must be',
    '   logged out, say so in "preconditions".',
    '8. Do not assume that element ids or positions correlate. If you need a',
    '   specific item, use the selector that names it, not an index.',
    '9. expect_absent is how you assert something is gone; do not assert empty',
    '   text on an element that stops existing.',
    '10. Assert on something that only becomes true BECAUSE of the steps. An',
    '    element that was already on screen before the test acted is not evidence,',
    '    and a URL that does not change proves nothing. Prefer the message, the',
    '    count, or the element that appears as a result. If the captured pages show',
    '    no such state for a case, drop that test rather than write one that cannot',
    '    fail — and say so is better than a green test that checks nothing.',
    '11. Output JSON only. No explanation, no markdown fence.',
  ].filter(Boolean).join('\n');
}

/** Feed validation failures back for a second attempt. */
export function plannerRepair(previous: string, errors: string[], feature: string): string {
  return [
    `Your previous plan for "${feature}" was rejected by the validator.`,
    '',
    'Errors:',
    ...errors.map(e => `- ${e}`),
    '',
    'Here is the JSON you produced:',
    '',
    previous,
    '',
    'Return the COMPLETE corrected JSON object — same shape, all tests included,',
    'every error above fixed. Remove any test you cannot express with the allowed',
    'actions and observed selectors rather than inventing something. JSON only.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export const FILE_MARKER = '=== FILE: ';
export const ADD_MARKER = '=== ADD TO: ';

export function generatorSystem(): string {
  return [
    'You are a senior test automation engineer who writes Python Playwright tests',
    'in the page-object style.',
    '',
    'You are given a validated test plan and you emit runnable pytest code. You',
    'write no prose: your entire reply is a sequence of blocks, each opened by a',
    'marker line.',
    '',
    `  "${FILE_MARKER}<path.py> ===" — a NEW file, followed by its complete contents.`,
    `  "${ADD_MARKER}<path.py> ===" — members to ADD to a file that already exists,`,
    '  followed by nothing but the locator attributes and the method definitions you',
    '  want appended. Never repeat what is already in that file.',
    '',
    'You copy selectors verbatim from the plan. You never invent one, never guess a',
    'URL, and never add a step the plan does not contain.',
  ].join('\n');
}

export interface GeneratorPromptInput {
  siteName: string;
  feature: string;
  planJson: string;
  /** Selector -> what was observed at that selector, for the ones the plan uses. */
  selectorNotes: string;
  /** Few-shot reference files, already formatted as file blocks. */
  reference: string;
  moduleName: string;
  /** Page objects already in the suite, which other test files depend on. */
  existing?: string;
}

export function generatorUser(input: GeneratorPromptInput): string {
  return [
    `## Test plan for "${input.feature}" on ${input.siteName}`,
    '',
    'One TEST block per test function, then its numbered steps: action, then the',
    'selector when the action takes one, then value=... when it takes a value.',
    '',
    input.planJson,
    '',
    '## What the plan selectors point at',
    '',
    input.selectorNotes,
    '',
    ...(input.existing ? [
      '## Page objects ALREADY in this suite — index only, bodies not shown',
      '',
      'Reuse these. Call a listed method rather than adding a second one that does',
      `the same thing; reuse a listed locator rather than writing a new`,
      '`page.locator(...)` for the same element. If something is genuinely missing,',
      `emit "${ADD_MARKER}<that path> ===" with ONLY the new locator attributes and`,
      'new methods — no class line, no imports, no existing member repeated. Never',
      'send one of these files as a whole file.',
      '',
      input.existing,
      '',
    ] : []),
    '## Reference: the exact style to follow',
    '',
    input.reference,
    '',
    '## What to produce',
    '',
    `- a whole file, \`${FILE_MARKER}models/<screen>_page.py ===\`, for each screen the`,
    '  plan touches that has no page object yet — every locator it needs plus small',
    '  action and expectation methods, class in PascalCase ending in `Page`;',
    `- \`${ADD_MARKER}models/<screen>_page.py ===\` for a screen that already has one and`,
    '  is missing something, or nothing at all for it if it is not;',
    `- exactly one test file, \`${input.moduleName}\`, one function per plan test, named`,
    '  exactly as the plan says, in the plan\'s order.',
    '',
    'Fixtures already exist — do not write conftest.py. `app: Page` is logged in with',
    'clean state and the base URL set, so `page.goto("/path")` works; `guest: Page` is',
    'logged out in a fresh context, for tests whose preconditions say logged out.',
    '',
    '## Rules',
    '',
    '1. Marker blocks only. No fences, no commentary, nothing after the last block.',
    '2. Copy every `page.locator(...)` string character-for-character from the plan.',
    '3. Locators live in page objects as `__init__` attributes; a test never calls',
    '   `page.locator(...)` itself.',
    '4. Assertions live in page-object methods via `expect()`. Map the plan:',
    '   expect_visible -> `to_be_visible()`, expect_absent -> `to_have_count(0)`,',
    '   expect_text -> `to_contain_text(...)`, expect_count -> `to_have_count(n)`,',
    '   expect_url -> `expect(self.page).to_have_url(...)`.',
    '5. Import page objects relatively: `from .models.<module> import <Class>`.',
    '6. No `time.sleep`, no clock waits — Playwright auto-waits and `expect()` retries.',
    '7. Never log in, reset state or close the page: the fixtures own all three.',
    '8. Each test takes exactly one fixture (`app` or `guest`), annotated `: Page`,',
    '   returns `-> None`, and uses the plan\'s "title" as its docstring.',
    '9. Import `Page` in the test file and `Page, expect` in each page object.',
    '10. Valid Python 3.10+ — it is compiled and run immediately.',
    '11. The fixture may ONLY be passed to a page-object constructor',
    '    (`cart = CartPage(app)`). Never `app.goto(...)`, `app.expect_*(...)` or',
    '    `expect(app)`. Everything a test does to the page is a page-object method,',
    '    URL assertions included. A plan step with action "goto" becomes an',
    '    `open()` method on the page object for that screen, which the test calls',
    '    first — dropping it gives a test that only passes when the browser happens',
    '    to already be on that page.',
    '12. Where the selector notes say a selector matches several elements, chain',
    '    `.first` (or `.nth(i)`) where the attribute is defined, or assert',
    '    `to_have_count(n)`. A singular assertion on a multi-match locator is a',
    '    strict-mode violation at runtime.',
    '12b. A page-object method returns None. Call it as a statement; never assign',
    '     its result or chain off it. `checkout = cart.click_checkout()` gives None,',
    '     and the next line fails with AttributeError on NoneType. Construct the',
    '     next page object from the fixture instead: `CheckoutStepOnePage(app)`.',
    '13. Only Playwright APIs you are certain exist: `to_be_visible`, `to_have_text`,',
    '    `to_contain_text`, `to_have_count`, `to_have_value`, `to_have_url`. An',
    '    invented method name compiles and then fails.',
  ].join('\n');
}

export interface GeneratorRepairInput {
  planJson: string;
  selectorNotes: string;
  moduleName: string;
  /** The previous reply in full, verbatim, with the problem files marked. */
  offending: string;
  /** Every block path the corrected reply must contain, as a checklist. */
  required?: string[];
  errors: string[];
  /** The page-object index, but only when an error is about an existing file. */
  existing?: string;
}

/**
 * A repair prompt must carry context — sending only an error list makes the model
 * redo the work from nothing, and it showed: one repair round invented a
 * directory prefix nobody had mentioned. But re-sending the WHOLE original
 * request makes the repair bigger than the thing it is repairing, and on a
 * congested free tier that is the one request guaranteed to be refused: 12k
 * generated fine, the 16.5k repair of it did not.
 *
 * So: the plan, the files that were actually wrong, the errors, and a compressed
 * reminder of the rules that matter. No few-shot example — the model has already
 * produced nearly-correct code and does not need to be taught the style again.
 */
export function generatorRepair(input: GeneratorRepairInput): string {
  return [
    'The files you produced were rejected by the validator. Fix them and send them',
    'again in the same marker-block format.',
    '',
    '## The plan they must implement',
    '',
    input.planJson,
    '',
    '## What the plan selectors point at',
    '',
    input.selectorNotes,
    '',
    ...(input.existing ? [
      '## Page objects already in this suite (index only — do not rewrite them)',
      '',
      input.existing,
      '',
    ] : []),
    '## What you sent, for the files with problems',
    '',
    input.offending,
    '',
    '## What is wrong with it',
    '',
    ...input.errors.map(e => `- ${e}`),
    '',
    '## Send again',
    '',
    `Marker blocks only. A whole new file is "${FILE_MARKER}<path> ===". Members to add`,
    `to a file that already exists are "${ADD_MARKER}<path> ===" — only the new`,
    'locator attributes and new methods, never an existing member repeated. Exactly',
    `one test file, \`${input.moduleName}\`. Re-send every file you sent before, with`,
    'the problems above fixed; do not add files nobody asked for, and do not send a',
    'patch or a diff.',
    // An explicit checklist, because "re-send every file you sent before" was not
    // enough three times over: a repair came back with only the page object and no
    // test file at all, and another dropped three page objects it had written the
    // round before. Naming the blocks turns a remembered instruction into a list
    // the reply can be checked against.
    ...(input.required?.length
      ? [
        '',
        'Your reply must contain exactly these blocks, in this order:',
        ...input.required.map(rel => `  - ${rel}`),
      ]
      : []),
    '',
    'The example is a format sample only. Its file and class names belong to no',
    'suite — import page objects from the index above and nothing else.',
    '',
    'The rules that were broken most often, restated: copy locator strings from the',
    'plan character-for-character; a test may only pass the fixture to a page-object',
    'constructor and never call `expect(...)` itself; every method a test calls must',
    'exist on its page object; chain `.first` where a selector matches several',
    'elements; leave the body of an existing method exactly as it is.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Healer
// ---------------------------------------------------------------------------

export function healerSystem(): string {
  return [
    'You repair broken UI test automation. You are given a failing pytest test, its',
    'error output, the page object that owns the locators involved, and a fresh',
    'capture of the page as it exists right now.',
    '',
    'You reply with exactly one of two things and nothing else:',
    '',
    'A) the marker line "FILE: <path>" followed by the COMPLETE corrected contents',
    '   of that one file, or',
    'B) the single word "NO_FIX" followed by one line explaining what a human must',
    '   decide.',
    '',
    'You change the smallest thing that can possibly work — normally a single',
    'locator string. You never weaken an assertion, never delete a test, never add',
    'a sleep, and never "fix" a test by making it check less.',
  ].join('\n');
}

export interface HealerPromptInput {
  testName: string;
  testTitle?: string;
  failureText: string;
  sourcePath: string;
  sourceCode: string;
  /** Live selector catalog of the pages this suite touches. */
  liveSelectors: string;
}

export function healerUser(input: HealerPromptInput): string {
  return [
    `## Failing test: ${input.testName}`,
    input.testTitle ? `intent: ${input.testTitle}` : '',
    '',
    '## Failure output',
    '',
    '```',
    input.failureText.slice(0, 4000),
    '```',
    '',
    `## The file that owns the locators: ${input.sourcePath}`,
    '',
    '```python',
    input.sourceCode,
    '```',
    '',
    '## The page as it exists right now',
    '',
    'These are the selectors currently present. If the locator the test uses is not',
    'in this list, that is why it fails, and the replacement must come from here.',
    '',
    input.liveSelectors,
    '',
    '## Decide',
    '',
    'If a locator in the file no longer matches anything and a clearly equivalent',
    'element exists in the live list, replace that locator and return the whole',
    'file. Prefer a [data-test="..."] selector over a class.',
    '',
    'If the failure is not a locator problem — the feature genuinely broke, the',
    'assertion is wrong about the product, data is missing, or the right fix is',
    'ambiguous — reply NO_FIX with one line saying which. A real defect must reach',
    'a human, not be papered over.',
    '',
    'Reply with "FILE: <path>" plus the complete file, or "NO_FIX" plus one line.',
  ].filter(Boolean).join('\n');
}
