# Cost ledger

Every model call this project has made, as recorded at the time it was made.
Regenerate with `npm run ledger`; the working file is `usage.json`, which is
not committed because it changes on every run.

The per-day and per-model totals below are **derived from the call log on every
read**, not stored alongside it. An earlier version of this ledger did keep a
separate running counter of failures, the counter's definition changed halfway
through 21 August, and the five failures already recorded before that point were
never back-filled — so the rollup read 18 where the call log said 23. A total
that cannot be recomputed cannot be corrected, and it fails in the flattering
direction.

## Headline

| | |
|---|---|
| Requests | **148** over 4 days (2026-08-19 → 2026-08-22) |
| Failed | 23 (15.5%) — refused, rate-limited or timed out |
| Tokens in / out | 379,648 / 320,054 |
| Distinct model ids | 14 |
| **Total spend** | **$0.0000** |

Failed requests are counted. They consumed an upstream attempt whether or not
they returned anything usable.

## By day

| Date | Sent | Failed | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|---:|
| 2026-08-19 | 21 | 0 | 84,390 | 43,135 | $0.0000 |
| 2026-08-20 | 40 | 0 | 130,691 | 69,459 | $0.0000 |
| 2026-08-21 | 46 | 12 | 75,236 | 95,966 | $0.0000 |
| 2026-08-22 | 41 | 11 | 89,331 | 111,494 | $0.0000 |
| **Total** | 148 | 23 | 379,648 | 320,054 | $0.0000 |

## By model

| Model | Sent | Failed | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|---:|
| `poolside/laguna-s-2.1:free` | 44 | 1 | 148,350 | 39,532 | $0.0000 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 33 | 2 | 111,011 | 84,623 | $0.0000 |
| `openrouter/free` | 14 | 14 | 0 | 0 | $0.0000 |
| `nvidia/nemotron-3-nano-30b-a3b:free` | 12 | 0 | 25,905 | 60,627 | $0.0000 |
| `dots-studio/dots-3-note-preview:free` | 10 | 1 | 21,387 | 45,424 | $0.0000 |
| `nvidia/nemotron-nano-12b-v2-vl:free` | 8 | 0 | 21,141 | 4,466 | $0.0000 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 6 | 0 | 13,232 | 26,407 | $0.0000 |
| `nvidia/nemotron-3-super-120b-a12b:free` | 4 | 0 | 10,520 | 20,737 | $0.0000 |
| `nvidia/nemotron-3.5-lightning:free` | 4 | 0 | 5,867 | 18,878 | $0.0000 |
| `nvidia/nemotron-nano-9b-v2:free` | 4 | 0 | 9,026 | 9,984 | $0.0000 |
| `poolside/laguna-xs-2.1:free` | 4 | 2 | 7,096 | 5,069 | $0.0000 |
| `cohere/north-mini-code:free` | 3 | 2 | 2,781 | 3,915 | $0.0000 |
| `google/gemma-4-26b-a4b-it:free` | 1 | 0 | 3,246 | 376 | $0.0000 |
| `openai/gpt-oss-20b:free` | 1 | 1 | 86 | 16 | $0.0000 |

`openrouter/free` is not a model — it is the auto-router, asked for whatever is
serving at that moment. It is listed here because it was requested that way, and
its failure rate is the reason the pipeline pins a model id instead.

## By role

| Role | Sent | Failed | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|---:|
| generator | 105 | 16 | 242,658 | 230,299 | $0.0000 |
| planner | 29 | 1 | 109,858 | 88,639 | $0.0000 |
| ping | 10 | 5 | 328 | 133 | $0.0000 |
| healer | 4 | 1 | 26,804 | 983 | $0.0000 |
