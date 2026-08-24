// Site descriptors are the ONLY place where site-specific knowledge lives.
// Adding a target product must mean adding one JSON file here — nothing under
// src/ may branch on a site id. That constraint is the point of the POC.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { configuredPath, fromRoot } from '../lib/config.js';

/** One step of the tiny action DSL shared by login flows and page prep. */
export interface SiteAction {
  action: 'goto' | 'fill' | 'click' | 'select' | 'press' | 'wait' | 'removeStorage';
  /** goto: path relative to baseUrl */
  path?: string;
  /** fill/click/select/press/wait: CSS selector */
  selector?: string;
  /** fill/select: literal value, or $user / $password to inject credentials */
  value?: string;
  /** press: key name, e.g. "Enter" */
  key?: string;
  /** wait: milliseconds, when no element can signal readiness */
  ms?: number;
  /** Skip silently when the selector is absent (cookie banners, toggles that
   *  are already in the wanted state). */
  optional?: boolean;
}

export interface SitePage {
  name: string;
  /** Path to navigate to. Omit when `before` already lands on the state worth
   *  capturing (e.g. an error banner that a navigation would wipe out). */
  path?: string;
  /** Selector that proves the page finished rendering. */
  ready?: string;
  /** false = capture before logging in. Defaults to true. */
  auth?: boolean;
  /** Actions that put the app into the state worth capturing. */
  before?: SiteAction[];
  /** Free-text hint handed to the planner alongside the snapshot. */
  note?: string;
}

export interface SiteDescriptor {
  id: string;
  name: string;
  baseUrl: string;
  /** Where generated pytest files for this site live, relative to the root. */
  testsDir: string;
  /** Short product brief injected into planner prompts. */
  facts: string;
  auth: {
    loginPath: string;
    credentials: { user: string; password: string };
    steps: SiteAction[];
    readySelector?: string;
  };
  /** Regex patterns for selectors that must never reach a test, because the
   *  application generates them from data: database ids, timestamps, ULIDs.
   *  They are perfectly valid right now and worthless after the next reseed, so
   *  the capture keeps them out of the catalog the planner is allowed to use. */
  unstableSelectors?: string[];
  /** How to return the app to a clean state. The browser session is shared
   *  across captures (and across tests), so without this a page captured
   *  later inherits the state an earlier one left behind. Run before each
   *  authenticated page's `before` steps. */
  resetState?: SiteAction[];
  /** Field values the live application is known to ACCEPT, verified by
   *  submitting the form rather than assumed.
   *
   *  This exists because a planner will invent plausible data and plausible is
   *  not the same as valid. "+355691234567" and "StrongPass123" both look fine
   *  and both are rejected by practicesoftwaretesting — the first because only
   *  digits are allowed, the second because a symbol is required. Two tests went
   *  red with correct assertions: they checked that only the field under test
   *  errors, and two other fields errored too. The capture can show which fields
   *  exist; only submitting can show what they accept. */
  sampleData?: Record<string, string>;
  pages: SitePage[];
}

function validate(d: unknown, file: string): SiteDescriptor {
  const s = d as Partial<SiteDescriptor>;
  const missing = (['id', 'name', 'baseUrl', 'testsDir', 'facts', 'auth', 'pages'] as const)
    .filter(k => s[k] === undefined);
  if (missing.length) throw new Error(`${file}: missing field(s) ${missing.join(', ')}`);
  if (!Array.isArray(s.pages) || s.pages.length === 0) throw new Error(`${file}: pages must be a non-empty array`);
  for (const p of s.pages) {
    if (!p.name) throw new Error(`${file}: every page needs a name`);
    if (typeof p.path !== 'string' && !p.before?.length) {
      throw new Error(`${file}: page "${p.name}" needs either a path or before steps`);
    }
  }
  if (!s.auth?.steps?.length) throw new Error(`${file}: auth.steps must describe the login flow`);
  return s as SiteDescriptor;
}

export function loadSite(id: string): SiteDescriptor {
  const file = path.join(configuredPath('sites'), `${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`Unknown site "${id}". Available: ${listSites().join(', ') || '(none)'}`);
  }
  return validate(JSON.parse(readFileSync(file, 'utf8')), path.relative(fromRoot(), file));
}

export function listSites(): string[] {
  const dir = configuredPath('sites');
  return existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : [];
}

/** Absolute URL for a descriptor-relative path. */
export function siteUrl(site: SiteDescriptor, p: string): string {
  return site.baseUrl.replace(/\/$/, '') + (p.startsWith('/') ? p : `/${p}`);
}

/** Credentials for a site, read from the env var names in the descriptor. */
export function siteCredentials(site: SiteDescriptor): { user: string; password: string } {
  const user = process.env[site.auth.credentials.user];
  const password = process.env[site.auth.credentials.password];
  if (!user || !password) {
    throw new Error(
      `Set ${site.auth.credentials.user} and ${site.auth.credentials.password} in .env for site "${site.id}"`,
    );
  }
  return { user, password };
}
