// The contract between planner and generator.
//
// Deliberately narrow: a fixed action vocabulary and selectors drawn from the
// captured catalog. A small free model is far better at filling in a rigid
// shape than at inventing a good one, and a rigid shape lets the generator be
// almost mechanical.

import type { Capture } from '../lib/context.js';
import { allowedSelectors, pagesForSelector } from '../lib/context.js';

export const STEP_ACTIONS = [
  'goto',            // path relative to the site base URL
  'fill',            // selector + value
  'click',           // selector
  'select',          // selector + value (option value or label)
  'press',           // selector + value (key name)
  'expect_visible',  // selector
  'expect_absent',   // selector
  'expect_text',     // selector + value (expected substring)
  'expect_url',      // value (substring of the URL)
  'expect_count',    // selector + value (integer as string)
] as const;

export type StepAction = typeof STEP_ACTIONS[number];

export interface PlanStep {
  action: StepAction;
  selector?: string;
  value?: string;
  note?: string;
}

export interface PlanTest {
  id: string;
  name: string;
  title: string;
  pages: string[];
  /** Free-text starting conditions, e.g. "logged in, empty cart". */
  preconditions?: string[];
  steps: PlanStep[];
  expected: string[];
  notes?: string;
}

export interface TestPlan {
  site: string;
  feature: string;
  tests: PlanTest[];
  meta?: {
    model?: string;
    generatedAt?: string;
    pagesUsed?: string[];
    repairs?: number;
  };
}

const NEEDS_SELECTOR = new Set<StepAction>([
  'fill', 'click', 'select', 'press', 'expect_visible', 'expect_absent', 'expect_text', 'expect_count',
]);
const NEEDS_VALUE = new Set<StepAction>(['fill', 'select', 'press', 'expect_text', 'expect_url', 'expect_count']);

/**
 * Validate a plan against the captured reality. Returns human-readable errors,
 * which are fed straight back to the model for a repair attempt — so each
 * message must say what is wrong AND what to do instead.
 */
export function validatePlan(plan: unknown, captures: Capture[], feature: string): string[] {
  const errors: string[] = [];
  const p = plan as Partial<TestPlan>;
  const known = allowedSelectors(captures);
  const knownPages = new Set(captures.map(c => c.page));

  if (!p || typeof p !== 'object') return ['Reply is not a JSON object.'];
  if (!Array.isArray(p.tests) || p.tests.length === 0) {
    return ['Missing a non-empty "tests" array.'];
  }
  // Nothing checks the "feature" field: the caller overwrites it with the value
  // it asked for. Rejecting a plan because the model wrote "product-sorting"
  // instead of "product sorting" spends a whole request from a 50-a-day budget on
  // a field the harness owns. Only reject what a human would have to fix.
  void feature;

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  p.tests.forEach((t, i) => {
    const where = `tests[${i}]${t?.name ? ` (${t.name})` : ''}`;
    if (!t || typeof t !== 'object') { errors.push(`${where}: not an object.`); return; }

    if (!t.id) errors.push(`${where}: missing "id".`);
    else if (seenIds.has(t.id)) errors.push(`${where}: duplicate id "${t.id}".`);
    else seenIds.add(t.id);

    if (!t.name) errors.push(`${where}: missing "name".`);
    else if (!/^test_[a-z0-9_]+$/.test(t.name)) {
      errors.push(`${where}: "name" must be a snake_case pytest function name matching test_[a-z0-9_]+, got "${t.name}".`);
    } else if (seenNames.has(t.name)) {
      errors.push(`${where}: duplicate test function name "${t.name}".`);
    } else seenNames.add(t.name);

    if (!t.title) errors.push(`${where}: missing "title" (the human-readable description).`);

    if (!Array.isArray(t.pages) || t.pages.length === 0) {
      errors.push(`${where}: "pages" must list at least one captured page (${[...knownPages].join(', ')}).`);
    } else {
      for (const page of t.pages) {
        if (!knownPages.has(page)) {
          errors.push(`${where}: unknown page "${page}". Captured pages are: ${[...knownPages].join(', ')}.`);
        }
      }
    }

    if (!Array.isArray(t.expected) || t.expected.length === 0) {
      errors.push(`${where}: "expected" must list at least one expected outcome.`);
    }

    if (!Array.isArray(t.steps) || t.steps.length === 0) {
      errors.push(`${where}: "steps" must contain at least one step.`);
      return;
    }

    const hasAssertion = t.steps.some(s => s?.action?.startsWith('expect_'));
    if (!hasAssertion) {
      errors.push(`${where}: no expect_* step — a test that asserts nothing cannot fail. Add at least one.`);
    }

    t.steps.forEach((s, j) => {
      const sw = `${where}.steps[${j}]`;
      if (!s || typeof s !== 'object') { errors.push(`${sw}: not an object.`); return; }
      if (!STEP_ACTIONS.includes(s.action)) {
        errors.push(`${sw}: unknown action "${s.action}". Allowed: ${STEP_ACTIONS.join(', ')}.`);
        return;
      }
      if (NEEDS_SELECTOR.has(s.action) && !s.selector) {
        errors.push(`${sw}: action "${s.action}" requires a "selector".`);
      }
      // fill accepts "" on purpose — clearing a field is a real test action.
      // Everything else needs something to compare or press.
      if (NEEDS_VALUE.has(s.action) && (s.value === undefined || (s.value === '' && s.action !== 'fill'))) {
        errors.push(`${sw}: action "${s.action}" requires a "value".`);
      }
      if (s.action === 'expect_count' && s.value !== undefined && !/^\d+$/.test(s.value)) {
        errors.push(`${sw}: expect_count "value" must be an integer, got "${s.value}".`);
      }
      if (s.action === 'goto' && !s.value?.startsWith('/')) {
        errors.push(`${sw}: goto "value" must be a path starting with "/", got "${s.value ?? ''}".`);
      }
      // A path is as perishable as a selector. The site's unstableSelectors
      // patterns exist to keep database ids and ULIDs out of tests, and they were
      // being applied to selectors only — so a plan opened
      // goto("/product/01M0MRXRTD5V08KC3NTDBNFSDG"), which works exactly until the
      // next reseed. Same rule, same reason, now both places.
      if (s.action === 'goto' && s.value) {
        const unstable = captures[0]?.unstable ?? [];
        if (unstable.some(re => new RegExp(re.source, re.flags.replace('g', '')).test(s.value!))) {
          errors.push(
            `${sw}: goto "${s.value}" contains a generated id this site declares unstable. ` +
            'Navigate to a stable path and click through instead.',
          );
        }
      }
      // A substring that every URL contains asserts nothing. This is the most
      // common way an LLM-written test passes without testing anything.
      if (s.action === 'expect_url' && s.value !== undefined && s.value.replace(/\//g, '').length < 2) {
        errors.push(
          `${sw}: expect_url "${s.value}" is satisfied by any URL and therefore asserts nothing. ` +
          'Use a distinctive part of the URL, or assert on a visible element instead.',
        );
      }
      // The core guard: no invented selectors.
      if (s.selector && !known.has(s.selector)) {
        const near = [...known].filter(k => {
          const core = s.selector!.replace(/^[#.]|\[data-test="|"\]$/g, '').toLowerCase();
          return core.length > 3 && k.toLowerCase().includes(core);
        }).slice(0, 3);
        errors.push(
          `${sw}: selector "${s.selector}" was never observed on any captured page. ` +
          (near.length ? `Did you mean ${near.join(' or ')}? ` : '') +
          'Use only selectors from the catalog.',
        );
      } else if (s.selector && Array.isArray(t.pages) && t.pages.length) {
        const on = pagesForSelector(captures, s.selector);
        if (on.length && !on.some(page => t.pages.includes(page))) {
          errors.push(
            `${sw}: selector "${s.selector}" exists only on page(s) ${on.join(', ')}, ` +
            `which this test does not list in "pages" (${t.pages.join(', ')}).`,
          );
        }
      }
    });
  });

  // Two tests that assert exactly the same things cannot both be testing what
  // their names claim. Cheap, mechanical, and it catches the case where a model
  // funnels every scenario into one weak check.
  const fingerprints = new Map<string, string>();
  for (const t of p.tests) {
    if (!Array.isArray(t?.steps)) continue;
    const asserts = t.steps
      .filter(s => s?.action?.startsWith('expect_'))
      .map(s => `${s.action}|${s.selector ?? ''}|${s.value ?? ''}`)
      .sort()
      .join(' ; ');
    if (!asserts) continue;
    const twin = fingerprints.get(asserts);
    if (twin) {
      errors.push(
        `${t.name} asserts exactly the same things as ${twin}. Two tests with identical ` +
        'assertions cannot both prove what their names say — give each one a check that is ' +
        'true only for its own scenario, or drop it.',
      );
    } else {
      fingerprints.set(asserts, t.name ?? 'an earlier test');
    }
  }

  return errors;
}
