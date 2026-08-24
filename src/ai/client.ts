// What the planner, generator and healer call. A role name, not a model id:
// which model serves "generator" is a config decision, and swapping it must not
// touch a single line of pipeline code.

import { roleConfig } from '../lib/config.js';
import { assertBudget, remainingToday } from '../lib/usage.js';
import { complete, type CompletionResult } from './openrouter.js';
import { step, warn, info, dim } from '../lib/log.js';

export interface AskParams {
  /** Key from config/ai.config.json → roles. */
  role: string;
  system: string;
  prompt: string;
  /** Short tag for logs and saved replies, e.g. "plan-login". */
  label?: string;
  /** Override the role's output cap for one call. */
  maxOutputTokens?: number;
  /** Send it exactly once: no retry, no fallback chain. For a canary run whose
   *  whole point is to learn the answer for the price of one request. */
  once?: boolean;
  /**
   * Pin one model, ignoring the role's configured chain.
   *
   * The point is not convenience. `openrouter/free` picks whichever free
   * endpoint is serving, and that choice includes model *size*: the same request
   * that a 550B model answered well on one day was answered by a 9B nano on the
   * next, served promptly and incoherently. Asking "was this a capacity problem
   * or a model-size problem" needs the ability to name the endpoint.
   */
  model?: string;
}

export interface AskResult extends CompletionResult {
  /** True when the primary model failed and a fallback answered instead. */
  usedFallback: boolean;
}

/**
 * Ask the model configured for a role, walking the fallback chain if it fails.
 * Free endpoints are genuinely flaky — they get rate-limited, rerouted and
 * occasionally return nothing — so a fallback chain is a requirement here, not
 * a nicety.
 */
export async function askModel(params: AskParams): Promise<AskResult> {
  const cfg = roleConfig(params.role);
  const label = params.label ?? params.role;
  const chain = params.model
    ? [params.model]
    : params.once ? [cfg.model] : [cfg.model, ...cfg.fallbacks];

  assertBudget(1);

  const failures: string[] = [];
  for (const [i, model] of chain.entries()) {
    if (i > 0) {
      // Every attempt costs a request from the daily budget.
      assertBudget(1);
      warn(`falling back to ${model}`);
    }
    step(`${label} → ${model} ${dim(`(${remainingToday()} requests left today)`)}`);
    try {
      const result = await complete({
        model,
        ...(params.once ? { maxAttempts: 1 } : {}),
        system: params.system,
        prompt: params.prompt,
        maxOutputTokens: params.maxOutputTokens ?? cfg.maxOutputTokens,
        temperature: cfg.temperature,
        label,
        role: params.role,
      });
      info(dim(
        `${result.promptTokens} in / ${result.completionTokens} out tokens, ` +
        `${(result.ms / 1000).toFixed(1)}s, $${result.cost.toFixed(4)}`,
      ));
      return { ...result, usedFallback: i > 0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A budget error is not the model's fault and no fallback can help.
      if (msg.startsWith('Daily request budget')) throw err;
      failures.push(`${model}: ${msg}`);
      warn(msg.slice(0, 200));
    }
  }

  throw new Error(`All models for role "${params.role}" failed:\n  ${failures.join('\n  ')}`);
}
