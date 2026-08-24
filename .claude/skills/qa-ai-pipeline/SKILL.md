---
name: qa-ai-pipeline
description: Working on the ai-qa-poc test generation pipeline — capturing pages, writing or splitting plans, generating or repairing tests, changing validation gates, or diagnosing why a generated test failed. Also use when a free-tier model refuses or returns a bad reply.
---

# ai-qa-poc — working on the pipeline

A thin pointer, deliberately. The knowledge lives in two files that are not
Claude-specific, so a free agent, another tool, or a person gets the same thing.

## Read first

1. **`docs/operating-rules.md`** — the rules, and what each one cost to learn.
   Read this before changing the harness or diagnosing a failure.
2. **`docs/agent-card.md`** — the same rules compressed to ~2.5k characters, for
   pasting into a generating prompt. Use this, not the long version, when the
   consumer is a model with a prompt budget.
3. **`docs/build-log.md`** — the evidence, chronological. Consult for a specific
   incident; do not read end to end.

## Before you change a gate

```bash
npm run gates          # 25 cases; must be green before and after
```

Expect the self-test to fail when you change what a gate does — that is the suite
working, not a problem. Update the expectation deliberately and write down the new
invariant.

Never patch source with shell string replacement. It writes invisible control
bytes; the gate suite scans for them because that happened twice.

## Before you spend a request

- **Probe the live application** for anything you are about to assert. Not memory,
  not the model's claim, not a note. Playwright from the scratchpad is free.
- **Re-judge what is already paid for**: `--validate-only` scores every saved reply
  against the current gates; `--apply-last` writes one that passes. After fixing a
  gate, a rejection often becomes a pass at no cost.
- **One test per plan.** Split anything larger — it is a mechanical JSON transform
  and it is the only shape that has generated cleanly on the first attempt.
- **Check the suite does not already have those tests.** The generator refuses a
  plan whose tests all exist, but a partial overlap still wastes the request.

## Commands

```bash
npm run capture  -- --site <id>
npm run plan     -- --site <id> --feature "<name>" --pages a,b --max-tests 2
npm run generate -- --plan plans/<file>.json --once          # single request, no retry
npm run generate -- --plan plans/<file>.json --repair-from-last --once
npm run generate -- --plan plans/<file>.json --validate-only # free
npm run generate -- --plan plans/<file>.json --apply-last    # free
npm run test     -- --site <id>                              # full suite, not one file
npm run heal     -- --site <id>
npm run usage
```

## Verifying

Run the **whole** suite, and each site separately. A single-file run proves less
than it looks like: a test that passes alone may have been relying on where a
previous test left the shared browser. One summary line from a command that ran two
suites is not evidence about both.

## Free tier

A refusal is usually worth one immediate retry — roughly a third clear. Size shifts
the odds without drawing a line, and the router picks capability as well as uptime,
so record which model answered and pin one when the question is about capability.
