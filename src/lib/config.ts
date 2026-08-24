// Loads config/ai.config.json and resolves every path in it against the project
// root, so scripts work no matter which directory they are invoked from.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RoleConfig {
  model: string;
  fallbacks: string[];
  maxOutputTokens: number;
  temperature: number;
}

export interface AiConfig {
  backend: 'openrouter';
  baseUrl: string;
  allowPaid: boolean;
  roles: Record<string, RoleConfig>;
  limits: {
    dailyRequestBudget: number;
    minRequestIntervalMs: number;
    requestTimeoutMs: number;
    maxRetries: number;
  };
  paths: {
    sites: string;
    plans: string;
    tests: string;
    reports: string;
    context: string;
    usageFile: string;
  };
}

/** Project root = one level above src/. Independent of process.cwd(). */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const fromRoot = (...parts: string[]) => path.join(projectRoot, ...parts);

let cached: AiConfig | undefined;

export function loadAiConfig(): AiConfig {
  if (!cached) {
    const file = fromRoot('config', 'ai.config.json');
    cached = JSON.parse(readFileSync(file, 'utf8')) as AiConfig;
  }
  return cached;
}

/** Resolved absolute path for one of the configured directories. */
export function configuredPath(key: keyof AiConfig['paths']): string {
  return fromRoot(loadAiConfig().paths[key]);
}

export function roleConfig(role: string): RoleConfig {
  const cfg = loadAiConfig();
  const r = cfg.roles[role];
  if (!r) throw new Error(`No AI role "${role}" in config/ai.config.json`);
  return r;
}
