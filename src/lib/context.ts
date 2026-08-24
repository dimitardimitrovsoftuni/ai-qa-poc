// Reads what capture produced and turns it into prompt-ready material.
//
// The selector catalog built here is the pipeline's hallucination guard: a plan
// may only reference selectors that were actually observed on the page, and the
// planner is handed exactly that list. Anything outside it is a validation
// error, not a surprise at pytest time.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { configuredPath } from './config.js';
import { loadSite } from '../sites/registry.js';

export interface CapturedElement {
  tag: string;
  id?: string;
  dataTest?: string;
  role?: string;
  type?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  text?: string;
}

export interface Capture {
  page: string;
  url: string;
  aria: string;
  elements: CapturedElement[];
  /** Data-generated selector patterns this site declares off-limits. */
  unstable: RegExp[];
}

/** Every selector form the generated tests are allowed to use for an element.
 *  Selectors matching the site's unstableSelectors patterns are withheld: they
 *  work today and break at the next data reseed, which is worse than not
 *  offering them at all. */
export function selectorsFor(el: CapturedElement, unstable: RegExp[] = []): string[] {
  // ONE canonical selector per element, in order of durability. Offering both
  // `#add-to-cart-x` and `[data-test="add-to-cart-x"]` for the same button let
  // two features pick different forms for the same element — and then the
  // generator, sensibly following the style already in the page object, produced
  // a locator the new plan had not sanctioned. One form per element removes the
  // choice, and shrinks the catalogue by a third.
  const out: string[] = [];
  if (el.dataTest) out.push(`[data-test="${el.dataTest}"]`);
  else if (el.id) out.push(`#${el.id}`);
  else if (el.className) out.push(`.${el.className.split(/\s+/).filter(Boolean).join('.')}`);
  return out.filter(s => !unstable.some(rx => rx.test(s)));
}

export function loadCaptures(siteId: string, only?: string[]): Capture[] {
  const dir = configuredPath('context');
  if (!existsSync(dir)) {
    throw new Error(`No captures yet. Run: npm run capture -- --site ${siteId}`);
  }
  const prefix = `${siteId}.`;
  const pages = readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.selectors.json'))
    .map(f => f.slice(prefix.length, -'.selectors.json'.length))
    .filter(p => !only || only.includes(p));

  if (!pages.length) {
    throw new Error(
      only
        ? `No captures for page(s) ${only.join(', ')} of site "${siteId}".`
        : `No captures for site "${siteId}". Run: npm run capture -- --site ${siteId}`,
    );
  }

  const unstable = (loadSite(siteId).unstableSelectors ?? []).map(p => new RegExp(p));

  return pages.map(page => {
    const inv = JSON.parse(readFileSync(path.join(dir, `${prefix}${page}.selectors.json`), 'utf8')) as
      { url: string; elements: CapturedElement[] };
    const ariaFile = path.join(dir, `${prefix}${page}.aria.yml`);
    const aria = existsSync(ariaFile) ? readFileSync(ariaFile, 'utf8') : '';
    return { page, url: inv.url, aria, elements: inv.elements, unstable };
  });
}

/** Compact, one-line-per-element view of what a page offers. */
export function selectorCatalog(capture: Capture): string {
  const lines = capture.elements
    .map(el => {
      const selectors = selectorsFor(el, capture.unstable);
      if (!selectors.length) return undefined;
      const attrs = [
        el.tag + (el.type ? `[type=${el.type}]` : ''),
        el.placeholder ? `placeholder="${el.placeholder}"` : undefined,
        el.text ? `text="${el.text}"` : undefined,
      ].filter(Boolean).join(' ');
      return `  ${selectors.join('  ')}   ${attrs}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

/** The full set of legal selectors across a set of captures. */
export function allowedSelectors(captures: Capture[]): Set<string> {
  const set = new Set<string>();
  for (const c of captures) for (const el of c.elements) for (const s of selectorsFor(el, c.unstable)) set.add(s);
  return set;
}

/** Which captured pages a selector was seen on — used in validation messages. */
export function pagesForSelector(captures: Capture[], selector: string): string[] {
  return captures
    .filter(c => c.elements.some(el => selectorsFor(el, c.unstable).includes(selector)))
    .map(c => c.page);
}
