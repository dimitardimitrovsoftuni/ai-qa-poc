// Capture what the model is allowed to "see": an ARIA snapshot (roles +
// accessible names) plus a machine-readable inventory of stable selectors, for
// every page listed in a site descriptor.
//
// Deliberately NOT screenshots: the strong free models are text-only, and the
// accessibility tree carries exactly the information a selector needs, at a
// fraction of the tokens. The selector inventory doubles as the planner's
// hallucination guard — a plan may only reference selectors that appear here.
//
//   npm run capture -- --site <id>
//   npm run capture -- --site <id> --pages login,cart --headed

import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { chromium, type Page } from 'playwright';
import { configuredPath, loadAiConfig } from '../lib/config.js';
import { loadSite, siteCredentials, siteUrl, listSites, type SiteAction, type SiteDescriptor, type SitePage } from '../sites/registry.js';
import { step, ok, warn, info, die, dim, bold } from '../lib/log.js';

interface Args { site: string; pages?: string[]; headed: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const site = get('--site');
  if (!site) die(`Usage: npm run capture -- --site <id>   (available: ${listSites().join(', ') || 'none'})`);
  const pages = get('--pages')?.split(',').map(s => s.trim()).filter(Boolean);
  return { site: site!, pages, headed: argv.includes('--headed') };
}

/** The action DSL: one executor for login steps and for page prep alike. */
async function runActions(page: Page, site: SiteDescriptor, actions: SiteAction[], creds: { user: string; password: string }): Promise<void> {
  for (const a of actions) {
    const value = a.value === '$user' ? creds.user : a.value === '$password' ? creds.password : a.value;
    if (a.optional && a.selector && (await page.locator(a.selector).count()) === 0) {
      info(dim(`skipped optional ${a.action} ${a.selector}`));
      continue;
    }
    switch (a.action) {
      case 'goto':
        await page.goto(siteUrl(site, a.path ?? '/'), { waitUntil: 'domcontentloaded' });
        break;
      case 'fill':
        await page.fill(a.selector!, value ?? '');
        break;
      case 'click':
        await page.click(a.selector!);
        break;
      case 'select':
        await page.selectOption(a.selector!, value ?? '');
        break;
      case 'press':
        await page.press(a.selector!, a.key ?? 'Enter');
        break;
      case 'wait':
        if (a.selector) await page.waitForSelector(a.selector, { state: 'visible' });
        else await page.waitForTimeout(a.ms ?? 1000);
        break;
      // Named keys only, never a blanket clear: this site keeps its cart in
      // sessionStorage (cart_quantity, cart_id) and, once signed in, its auth
      // there too. Wiping everything would log the session out mid-run.
      case 'removeStorage':
        await page.evaluate((keys: string[]) => {
          for (const key of keys) {
            window.localStorage.removeItem(key);
            window.sessionStorage.removeItem(key);
          }
        }, (value ?? '').split(',').map(k => k.trim()).filter(Boolean));
        break;
      default:
        throw new Error(`Unknown action "${(a as SiteAction).action}" in site descriptor`);
    }
  }
}

async function login(page: Page, site: SiteDescriptor, creds: { user: string; password: string }): Promise<void> {
  await page.goto(siteUrl(site, site.auth.loginPath), { waitUntil: 'domcontentloaded' });
  await runActions(page, site, site.auth.steps, creds);
  if (site.auth.readySelector) {
    await page.waitForSelector(site.auth.readySelector, { state: 'visible', timeout: 30_000 });
  }
}

/** Stable, automation-friendly handles for every interactive element on screen. */
async function selectorInventory(page: Page) {
  return page.evaluate(() => {
    const sel = 'a,button,input,select,textarea,[role],[data-test],[data-testid],[id]';
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll(sel))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(el => {
        const e = el as HTMLElement;
        const entry = {
          tag: e.tagName.toLowerCase(),
          id: e.id || undefined,
          dataTest: e.getAttribute('data-test') ?? e.getAttribute('data-testid') ?? undefined,
          role: e.getAttribute('role') ?? undefined,
          type: e.getAttribute('type') ?? undefined,
          name: e.getAttribute('name') ?? undefined,
          placeholder: e.getAttribute('placeholder') ?? undefined,
          className: e.className && typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 3).join(' ') : undefined,
          text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60) || undefined,
        };
        return entry;
      })
      .filter(entry => {
        // One row per distinct handle; repeated list items add no information.
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
}

async function capturePage(page: Page, site: SiteDescriptor, p: SitePage, creds: { user: string; password: string }, outDir: string): Promise<void> {
  // Each authenticated page starts from a known state — otherwise a capture
  // inherits whatever the previous one left in the session (an item already in
  // the cart turns an add button into a remove button, and the step times out).
  if (p.auth !== false && site.resetState?.length) await runActions(page, site, site.resetState, creds);
  if (p.before?.length) await runActions(page, site, p.before, creds);
  // No path = the before steps already produced the state to capture, and a
  // navigation would destroy it (error banners, unsaved form state).
  if (p.path) await page.goto(siteUrl(site, p.path), { waitUntil: 'domcontentloaded' });
  if (p.ready) {
    try {
      await page.waitForSelector(p.ready, { state: 'visible', timeout: 20_000 });
    } catch {
      warn(`${p.name}: ready selector "${p.ready}" never became visible — capturing anyway`);
    }
  }

  let aria: string;
  try {
    aria = await page.locator('body').ariaSnapshot();
  } catch (err) {
    die(`locator.ariaSnapshot() unavailable (${(err as Error).message}). Needs Playwright >= 1.49 — run npm install.`);
  }

  const inventory = await selectorInventory(page);
  const url = page.url();

  const header = [
    `# site: ${site.id} (${site.name})`,
    `# page: ${p.name}`,
    `# url:  ${url}`,
    p.note ? `# note: ${p.note}` : undefined,
    '# Captured accessibility tree. Roles and accessible names only — this is',
    '# what the planner reasons over.',
    '',
  ].filter(Boolean).join('\n');

  const ariaFile = path.join(outDir, `${site.id}.${p.name}.aria.yml`);
  const invFile = path.join(outDir, `${site.id}.${p.name}.selectors.json`);
  writeFileSync(ariaFile, `${header}${aria}\n`, 'utf8');
  writeFileSync(invFile, `${JSON.stringify({ site: site.id, page: p.name, url, elements: inventory }, null, 2)}\n`, 'utf8');

  const lines = aria.split('\n').length;
  ok(`${bold(p.name)} ${dim(`→ ${lines} aria lines, ${inventory.length} selectors`)}`);
  info(path.basename(ariaFile) + '  +  ' + path.basename(invFile));
}

export interface CaptureOptions {
  siteId: string;
  pages?: string[];
  headed?: boolean;
  /** Suppress the per-page log lines when another command drives the capture. */
  quiet?: boolean;
}

/** Capture pages of a site. Used by the CLI below and by the healer, which
 *  needs to see the page as it is NOW before proposing a locator fix. */
export async function captureSite(opts: CaptureOptions): Promise<string[]> {
  const args = { site: opts.siteId, pages: opts.pages, headed: opts.headed ?? false };
  const site = loadSite(args.site);
  const creds = siteCredentials(site);
  const outDir = configuredPath('context');
  mkdirSync(outDir, { recursive: true });

  const pages = args.pages
    ? site.pages.filter(p => args.pages!.includes(p.name))
    : site.pages;
  if (!pages.length) die(`No matching pages. Descriptor has: ${site.pages.map(p => p.name).join(', ')}`);

  step(`Capturing ${bold(site.name)} — ${pages.length} page(s) → ${path.basename(outDir)}/`);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(loadAiConfig().limits.requestTimeoutMs > 0 ? 30_000 : 30_000);

  try {
    // Capture unauthenticated pages first, so the login snapshot is taken while
    // still logged out; then log in once and continue with the rest.
    const anonymous = pages.filter(p => p.auth === false);
    const authed = pages.filter(p => p.auth !== false);

    for (const p of anonymous) await capturePage(page, site, p, creds, outDir);

    if (authed.length) {
      step(`Logging in as ${creds.user}`);
      await login(page, site, creds);
      ok('logged in');
      for (const p of authed) await capturePage(page, site, p, creds, outDir);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  ok(bold('capture complete'));
  return pages.map(p => p.name);
}

async function main(): Promise<void> {
  const args = parseArgs();
  await captureSite({ siteId: args.site, pages: args.pages, headed: args.headed });
}

// Only run as a CLI when invoked directly; importing this module must not
// launch a browser.
if (process.argv[1] && path.basename(process.argv[1]).startsWith('snapshot')) {
  main().catch(err => die(err instanceof Error ? err.message : String(err)));
}
