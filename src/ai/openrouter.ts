// The only place that talks HTTP to a model provider.
//
// OpenRouter speaks the OpenAI chat-completions shape, so swapping providers
// later means changing this file alone. Everything above it calls askModel()
// in client.ts and never sees a request body.

import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { loadAiConfig, configuredPath } from '../lib/config.js';
import { record, type CallRecord } from '../lib/usage.js';
import { dim, info } from '../lib/log.js';

export interface CompletionRequest {
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  /** Used for the saved reply filename and log lines. */
  label: string;
  /** Attributed to this role in the usage ledger. */
  role: string;
  /** Cap the attempts for THIS request. 1 = send it once and report what
   *  happened. Used by the canary run: on a free tier, discovering that an
   *  endpoint is congested should cost one request, not six. */
  maxAttempts?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  ms: number;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 520, 522, 524]);

let lastRequestAt = 0;

/** The free tier allows 20 requests/minute; space calls out rather than get 429d. */
async function throttle(): Promise<void> {
  const gap = loadAiConfig().limits.minRequestIntervalMs;
  const wait = lastRequestAt + gap - Date.now();
  if (wait > 0) {
    info(dim(`throttling ${Math.ceil(wait / 100) / 10}s (free tier: 20 req/min)`));
    await new Promise(r => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Persist the raw reply — indispensable when a small model returns something odd. */
function saveReply(label: string, model: string, text: string): void {
  const dir = path.join(configuredPath('context'), 'replies');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeModel = model.replace(/[/:]/g, '_');
  writeFileSync(path.join(dir, `${stamp}.${label}.${safeModel}.txt`), text, 'utf8');
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const cfg = loadAiConfig();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to .env — see PLAN.md §8.');
  }
  if (!cfg.allowPaid && !req.model.endsWith(':free') && req.model !== 'openrouter/free') {
    throw new Error(
      `Refusing to call paid model "${req.model}" while allowPaid=false. ` +
      'Free-only is the premise of this POC; change config/ai.config.json deliberately.',
    );
  }

  const body = {
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ],
    max_tokens: req.maxOutputTokens,
    temperature: req.temperature,
    // Ask OpenRouter to report what the call cost, so the ledger is measured
    // rather than assumed.
    usage: { include: true },
  };

  const attempts = Math.max(1, Math.min(req.maxAttempts ?? cfg.limits.maxRetries, cfg.limits.maxRetries));
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await throttle();
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.limits.requestTimeoutMs);

    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // Optional attribution headers OpenRouter uses for its dashboards.
          'HTTP-Referer': 'https://github.com/local/ai-qa-poc',
          'X-Title': 'ai-qa-poc',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        lastError = `HTTP ${res.status} ${res.statusText}: ${detail}`;
        if (!RETRYABLE.has(res.status) || attempt === attempts) {
          throw new Error(lastError);
        }
        // Honour Retry-After when the provider sends one; otherwise back off.
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2000 * 2 ** (attempt - 1);
        info(dim(`${lastError.slice(0, 120)} — retrying in ${Math.round(delay / 1000)}s (${attempt}/${attempts})`));
        await sleep(delay);
        continue;
      }

      const json = await res.json() as {
        model?: string;
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        error?: { message?: string };
      };

      if (json.error) throw new Error(`Provider error: ${json.error.message ?? 'unknown'}`);

      const choice = json.choices?.[0];
      const text = choice?.message?.content ?? '';
      const ms = Date.now() - started;
      const result: CompletionResult = {
        text,
        model: json.model ?? req.model,
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        cost: json.usage?.cost ?? 0,
        ms,
      };

      const ledger: CallRecord = {
        ts: new Date().toISOString(),
        role: req.role,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        cost: result.cost,
        ms,
        ok: text.length > 0,
      };
      record(ledger);
      saveReply(req.label, result.model, text);

      if (!text.trim()) {
        // A truncated or empty reply is a failure worth retrying on another model.
        throw new Error(`Empty reply from ${result.model} (finish_reason=${choice?.finish_reason ?? 'unknown'})`);
      }
      if (choice?.finish_reason === 'length') {
        info(dim(`warning: ${result.model} stopped at the output limit — reply may be truncated`));
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      // A refused or timed-out request still consumed an upstream attempt. Only
      // counting the successes made the local budget optimistic — six requests
      // sent, four recorded — and the budget is what the batch runner trusts
      // before starting a feature.
      if (!/^Empty reply from/.test(msg)) {
        record({
          ts: new Date().toISOString(),
          role: req.role,
          model: req.model,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          ms: Date.now() - started,
          ok: false,
          error: msg.slice(0, 160),
        });
      }
      const aborted = msg.includes('aborted') || msg.includes('abort');
      if (attempt === attempts) break;
      if (aborted) {
        info(dim(`timeout after ${cfg.limits.requestTimeoutMs / 1000}s — retrying (${attempt}/${attempts})`));
        continue;
      }
      if (!/HTTP \d+/.test(msg)) {
        info(dim(`${msg.slice(0, 120)} — retrying (${attempt}/${attempts})`));
        await sleep(2000 * attempt);
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${req.model} failed after ${attempts} attempt(s): ${lastError}`);
}
