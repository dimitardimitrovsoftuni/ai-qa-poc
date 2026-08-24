# ai-qa-poc

A test **planner**, **generator** and **self-healer** for web UIs that runs on
**free LLMs only** — 41 tests across 19 features on 2 unrelated sites, all passing,
total model spend **$0.00** for the whole build.

The engine knows nothing about any particular product. A target is one JSON
descriptor in `config/sites/`; everything else is discovered by reading the live
accessibility tree.

```
capture ──> plan ──> generate ──> run ──> heal
```

| Stage | What happens | Who does it |
|---|---|---|
| **capture** | logs into the target, records each page as an ARIA tree plus an inventory of stable selectors | Playwright |
| **plan** | turns those captures into a structured test plan (JSON) | free model |
| **generate** | turns the plan into Python page objects and pytest tests, **adding to** the ones already there | free model |
| **run** | executes them, writes JUnit XML | pytest |
| **heal** | reads a failure, re-reads the live page, patches the broken locator | free model |

Text, not screenshots: the strongest free models are text-only, and an
accessibility tree carries the roles and names a selector is built from at a
fraction of the tokens.

## Quick start

```bash
npm install
python -m pip install -r requirements.txt
npx playwright install chromium
cp .env.example .env          # then add OPENROUTER_API_KEY (free, no card)
npm run doctor                # preflight: toolchain, browsers, config, credentials
```

Then either walk the stages:

```bash
npm run capture  -- --site saucedemo
npm run plan     -- --site saucedemo --feature "login"
npm run generate -- --plan plans/saucedemo_login.json
npm run test     -- --site saucedemo
npm run heal     -- --site saucedemo          # only if something is red
npm run usage                                 # what it cost
```

…or watch the whole story, break and repair included, in one command:

```bash
npm run demo -- --site saucedemo --feature "login"
```

`npm run demo` captures, plans, generates, runs, then renames a locator the way
a front-end change would, shows the suite go red, heals it, and runs again —
restoring every file it touched on the way out.

## Targets

| Site | Why it is here | Suite |
|---|---|---|
| [saucedemo.com](https://www.saucedemo.com) | login, catalogue, cart, three-step checkout, plus deliberately broken accounts | `tests/saucedemo/` |
| [practicesoftwaretesting.com](https://practicesoftwaretesting.com) | Angular SPA with a real API and database — proves the engine is domain-agnostic | `tests/practicesoftwaretesting/` |

Adding the second site cost one descriptor, a three-line `conftest.py`, and one
generic capability in the engine (see `docs/build-log.md` §7c — recorded honestly rather
than glossed over). No file under `src/` mentions either site; that grep is the
POC's core claim and it is checked.

Both are public sites published for automation practice. Runs are sequential
and single-browser; this is a demo, not a load generator.

## The generator only ever adds

For a screen with no page object yet, the model returns a whole new file. For a
screen that already has one, it returns *only* the members to be added, and the
harness merges them — locator attributes into `__init__`, methods onto the end of
the class.

This started out as whole-file regeneration, which is simpler and worked for the
first two features per site. Then it deleted a passing suite's methods, and the
prompt began growing with the suite until the free endpoint refused it. `docs/build-log.md`
§7h–§7i record the whole arc. Under the current contract the model cannot delete
a method another suite calls or change what an existing one does, and the prompt
gets *smaller* as a suite matures.

## How a hallucinated selector is stopped

The interesting part of driving a weak model is not the prompt, it is the gates
around it.

1. **The planner may only use selectors that were observed.** The capture emits
   a catalog; a plan referencing anything outside it is rejected, with the near
   misses named in the error.
2. **Selectors the application generates from data never enter the catalog.**
   `unstableSelectors` in the descriptor filters out database ids and ULIDs —
   they work today and rot at the next reseed.
3. **A plan must assert something.** Every test needs an `expect_*` step, and an
   assertion that any page would satisfy (`expect_url: "/"`) is an error.
4. **Generated code may only use locators the plan sanctioned**, must keep
   locators inside page objects, must not contain sleeps, and has to compile
   under the real Python interpreter before it is written to the suite.
5. **A test may not touch the browser directly.** The fixture goes into a page
   object and nowhere else — a style rule that turned out to be a correctness
   gate against invented APIs.
6. **A generated file may not lose a member another test depends on**, and a
   page object carried over from an earlier feature keeps its own locators.
7. **The healer may not weaken a test.** A patch that drops an assertion, adds
   a sleep, or edits a file other than the one owning the failing locator is
   refused — and `NO_FIX` is a valid, successful answer, because a genuine
   defect must reach a human.

Every rejection is fed back to the model with the reason. In practice that
recovers most first-draft mistakes in one round.

**The gates have their own tests.** `npm run gates` feeds each one an input it
must reject and a sound input it must accept. This is not tidiness: four gates
were once dead at the same time — two because a shell edit wrote a literal
backspace byte into a regex, two because a string-replacement patch silently
failed to apply — and nothing looked wrong, because a gate that cannot fire
produces exactly the same output as a gate that passes. The self-check found both
pairs in one run. Add a case whenever you add a gate.

## What a small free model gets wrong

Measured, not guessed — every item below happened during this build.

- **It invents specific-looking selectors.** Asked for four products it produced
  `[data-test="product-name"]:nth-of-type(2)`, `(3)`, `(4)` — plausible CSS that
  was never on the page. The catalog check caught all three.
- **It writes assertions that cannot fail.** `expect_url: "/"` is satisfied by
  every URL on the site. A test containing it passes forever and tests nothing.
- **It reaches for whatever is most specific**, including the database ids that
  change on every reseed, unless it is actively prevented.
- **It drops required fields under load.** Two `fill` steps arrived without a
  value; the repair round fixed both — and its fix (leave the field untouched)
  was better than what was asked for.
- **It invents API methods, not just selectors.** A generated test called
  `app.expect_to_have_url(...)`, which does not exist in Playwright. It compiled
  and used no locator, so nothing caught it until runtime. The fix is
  structural: a test may only pass the fixture into a page-object constructor.
- **It deletes what it cannot see.** Generating a second feature rewrote a page
  object the first feature's tests used, dropping the methods they called — five
  green tests went red without being touched. Existing page objects now go into
  the prompt to be extended, and a gate rejects any file that loses a member.
- **It writes a suite that passes and proves nothing — and that one shipped
  green.** The first contact-form suite was 3/3 and worthless: every test ended
  in "the URL still contains /contact", true before and after any submission.
  Root cause was the capture, not the model — the clean form has no error
  elements, so nothing failure-shaped was in the catalogue to assert on.
  Capturing the failed-submit state fixed it (see `docs/build-log.md` §7e). **The capture
  sets a ceiling on how good an assertion can be, and no gate can lift it.**
- **It rewrites the bodies of methods it was told to keep.** Adding a feature
  regenerates shared page objects; one run brought `expect_url()` back asserting
  a different URL, with the signature untouched. Preserving names is not enough —
  a gate now requires existing method bodies to come back byte-identical.
- **It copies its example too faithfully.** The reference sample handed to the
  generator initially contained a missing import; the model reproduced the
  mistake. Few-shot examples are code, and they need reviewing like code.
- **Free endpoints do not merely slow down — they hand the job to a weaker
  model.** The same endpoint served a 13.7k-character prompt in 35 seconds and,
  an hour later, would not serve 11.8k at all. When it stalls, the fallback
  chain reaches a smaller model — and that run is exactly the one that produced
  the invented Playwright API above. The mitigations that worked: send less
  (aim the context, drop the planner's prose), split a feature into ~3-test
  plans, retry fewer times rather than longer, and swap the model in config.

The gates matter more than the model. Swap in a stronger model and the same
harness gets better output; remove the gates and even a strong model quietly
produces a suite that passes without testing anything.

## Cost

```
npm run usage      # tokens and spend, per day and per model
npm run ledger     # freeze that into docs/cost-ledger.{md,json}
npm run gates      # prove every validation still fires
npm run batch -- --file batches/<name>.json   # plan+generate several features
```

**[`docs/cost-ledger.md`](docs/cost-ledger.md)** is the committed snapshot: 148
requests over 4 days, 23 of them failed, 14 model ids, $0.0000 — every call, so
the headline number above can be recomputed rather than taken on trust.

Free tier: 20 requests/minute, 50/day (1000/day after a one-time $10 credit
purchase). `src/lib/usage.ts` keeps a local ledger and refuses to start a run
that would exceed the configured daily budget, so a run never dies half-written.
Per-day and per-model totals are derived from the call log on every read, never
stored beside it — a rollup that cannot be recomputed cannot be corrected, and
this one had already drifted low once.

## Where things are

| Path | What |
|---|---|
| `docs/operating-rules.md` | the rules, and what each one cost to learn — read before changing the harness |
| `docs/agent-card.md` | the same rules compressed to ~2.9k chars, for an agent working outside this repo |
| `docs/build-log.md` | the evidence: every failure in the order it happened |
| `docs/cost-ledger.md` | every model call made, with the totals derived from it |
| `.claude/skills/qa-ai-pipeline/` | Claude Code entry point; points at the two files above |
| `config/ai.config.json` | model per role, fallback chains, limits |
| `config/sites/*.json` | one descriptor per target — the only site knowledge |
| `plans/*.json` | generated test plans (committed: they are the artifact) |
| `tests/<site>/` | generated pytest suites |
| `src/` | the engine — site-agnostic by rule |
| `.ai_context/` | captures and raw model replies (gitignored) |
