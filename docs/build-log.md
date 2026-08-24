# Build log

Not a plan — a running record of how this pipeline was built, in the order it
happened, including the parts that went wrong. It was called PLAN.md for most of
its life and stopped being one after the first week.

Read it if you want the evidence behind the write-up in `linkedin_article.md`:
every claim there has a section here with the numbers it came from. Sections are
roughly chronological; the §7 series is the day-by-day record of the free-model
work and is where the interesting failures live.

## 1. What this proves

1. A test planner, generator and self-healer can run on **$0.00 of model spend**.
2. The pipeline is **product-agnostic** — site #1 (SauceDemo) and site #2
   (practicesoftwaretesting.com) share the same engine, differing only by a
   site descriptor JSON + a pytest conftest fixture.
3. Self-healing is real, not a slide: we break a selector on purpose, the suite
   goes red, the healer patches the page object, the re-run goes green.

## 2. Hard rules

- **Zero content from any employer/product.** No employer product names, URLs,
  credentials, selectors, test names or prose anywhere in this repo. This repo
  is shareable as-is.
- **Free models only.** No paid model ids in `config/ai.config.json`. If a run
  needs a paid model, the run fails loudly rather than silently billing.
- **Nothing site-specific under `src/`.** Site knowledge lives in
  `config/sites/<id>.json` and in the generated `tests/<id>/` tree. A grep for
  `saucedemo` under `src/` must return nothing — this is the POC core claim.
- **Public practice sites only.** SauceDemo and practicesoftwaretesting.com
  exist to be automated. No load/stress traffic; one browser, sequential runs.
- **Generated code is reviewed by a human before it is committed as passing.**

## 3. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Target site #1 | `https://www.saucedemo.com` | Stable for years, real login + 3-step checkout, and the built-in broken users (`problem_user`, `performance_glitch_user`) give the healer genuine defects to react to. `robots.txt` = `Disallow:` (nothing disallowed), verified 2026-08-19. |
| Target site #2 (Phase 6) | `https://practicesoftwaretesting.com` | Modern SPA + real backend; proves multi-domain. |
| Generated test stack | **Python + pytest + Playwright, POM** | Matches the operator expertise; JUnit XML is what the healer consumes; generator/healer logic carries over from prior work. |
| Orchestrator stack | **TypeScript + tsx (Node 24)** | Same as prior work; no build step. |
| Page perception | **ARIA snapshot (text), not screenshots** | Free models with vision are the weak ones; the free coding models are text-only. `locator.aria_snapshot()` yields roles + accessible names, which is strictly *better* input for selector generation than a PNG, and costs far fewer tokens. |
| AI backend | OpenRouter `/api/v1/chat/completions` (OpenAI-compatible) | One key, many free models, hot-swappable per role. |
| Agentic browsing (`--browse`) | **Out of scope for v1**, optional Phase 8 | 30–70 requests/run vs a 50/day free cap; also the highest-risk code for a small model. |

## 4. Architecture

```
ai-qa-poc/
  PLAN.md  README.md  .env.example  .gitignore
  package.json  tsconfig.json  requirements.txt
  config/
    ai.config.json              # model per role + limits + backend
    sites/saucedemo.json        # site descriptor (Phase 2)
    sites/practicesoftwaretesting.json   # (Phase 6)
  src/
    ai/openrouter.ts            # HTTP, retries, 429 backoff, usage accounting
    ai/client.ts                # askModel({role, system, prompt}) dispatcher
    lib/log.ts  lib/files.ts  lib/usage.ts  lib/prompts.ts
    sites/registry.ts           # load + validate site descriptors
    capture/snapshot.ts         # login per descriptor -> ARIA snapshot files
    planner/run_planner.ts      # snapshot -> plan JSON (schema-checked)
    generator/run_generator.ts  # plan JSON -> pytest POM files
    runner/run_tests.ts         # spawn pytest -> reports/<site>.xml
    healer/run_healer.ts        # XML -> locate POM file -> patched selector
    tools/doctor.ts             # env/toolchain preflight
  tests/
    conftest.py                 # shared: browser/context/page fixtures
    saucedemo/{models/,test_*.py}
  plans/                        # generated plan JSON (COMMITTED - the artifact)
  reports/                      # JUnit XML (gitignored)
  .ai_context/                  # ARIA snapshots + raw model replies (gitignored)
```

Data flow:

```
site descriptor ─┐
                 ├─> capture ──> .ai_context/<site>.<page>.yml ─┐
feature name ────┘                                             ├─> planner ──> plans/<site>_<feature>.json
                                                               │
plans/*.json ──> generator ──> tests/<site>/models/*.py + test_*.py
                                     │
                                     └──> runner (pytest) ──> reports/<site>.xml
                                                                    │
                                                    (failures) ─────┴──> healer ──> patched *.py (+ .pre_heal backup)
```

## 5. Model roster (live OpenRouter data, verified 2026-08-19)

All free, all support tool calling, all text-only unless noted.

| Role | Model id | Context / max out | Notes |
|---|---|---|---|
| generator, healer | `poolside/laguna-s-2.1:free` | 262K / 32K | 118B agentic coding model, 78.5% SWE-bench Multilingual — best free coder available |
| planner | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M / 64K | biggest free context, good at structured planning |
| fallback A | `cohere/north-mini-code:free` | 256K / 64K | 30B MoE coding, strict JSON |
| fallback B | `z-ai/glm-5.2:free` | 256K / 256K | |
| last resort | `openrouter/free` | 200K | router; picks any free model that supports the request |
| (vision, only if ever needed) | `google/gemma-4-31b-it:free` | 262K | image+text; not used by design |

**Free-tier limits (OpenRouter, official):** 20 requests/minute and **50
requests/day**; the daily cap rises to 1000 only after a one-time purchase of
$10 of credit. `src/lib/usage.ts` keeps a local day counter and refuses to
start a run that would exceed a configurable `dailyRequestBudget` (default 40),
so the cap is never hit mid-suite.

**Privacy:** free endpoints route to providers that may train on submitted
data (OpenRouter has a separate privacy toggle for free vs paid). Acceptable
here *because* the repo contains only public demo-site content — which is
exactly why the "zero employer content" rule in §2 is non-negotiable.

## 6. Phases

Each phase ends in something runnable. Tick the box and update §9 when done.

### [x] Phase 0 — Skeleton  (done 2026-08-19)
Repo, `package.json`, `tsconfig.json`, `requirements.txt`, `.env.example`,
`.gitignore`, `config/ai.config.json`, `src/tools/doctor.ts`.
**Done when:** `npm run doctor` prints node/python/pytest/playwright versions,
whether `OPENROUTER_API_KEY` is present, and exits 0.
**Needs no API key.**

### [x] Phase 1 — AI client  (done 2026-08-19)
`src/ai/openrouter.ts` (fetch, 60s timeout, 3 retries with backoff on 429/5xx,
token + cost accounting, raw reply dumped to `.ai_context/`),
`src/ai/client.ts` (`askModel({role,...})` resolves role → model id from config,
walks the fallback chain on hard failure), `npm run ai:ping`.
**Done when:** `npm run ai:ping` gets a reply from `laguna-s-2.1:free` and
prints prompt/completion tokens and `$0.0000`.
**BLOCKED until the operator supplies `OPENROUTER_API_KEY`** (see §8).

### [x] Phase 2 — Site registry + capture  (done 2026-08-19)
`config/sites/saucedemo.json`, `src/sites/registry.ts`,
`src/capture/snapshot.ts`, `npm run capture -- --site saucedemo`.
Descriptor drives: base URL, login steps, ready selector, credential env vars,
list of pages to snapshot, and a short `facts` brief injected into prompts.
**Done when:** ARIA snapshots for login/inventory/cart/checkout land in
`.ai_context/` and the real selectors are confirmed against §7.
**Needs no API key** — do this while waiting for the key.

### [x] Phase 3 — Planner  (done 2026-08-19)
`src/planner/run_planner.ts` + JSON schema. Input: site descriptor + snapshots
+ `--feature`. Output: `plans/<site>_<feature>.json` — an array of test cases,
each with `name`, `description`, `steps[]`, `expected[]`, and the concrete
selectors it intends to use, drawn from the snapshot.
**Done when:** a schema-valid plan for `login` and for `checkout` exists, and
every selector in it appears in the captured snapshot (the validator enforces
this — it is the cheapest possible hallucination guard).

### [x] Phase 4 — Generator + runner  (done 2026-08-19)
`src/generator/run_generator.ts`: plan JSON → `tests/<site>/models/*.py` page
objects + `test_*.py`. `src/runner/run_tests.ts`: pytest with
`--junitxml=reports/<site>.xml`. Filename-collision guard (never overwrite an
existing test file without `--force`).
**Done when:** generated login + checkout suites run green headed and headless.

### [x] Phase 5 — Healer (the demo moment)  (done 2026-08-19)
`src/healer/run_healer.ts`: parse JUnit XML → failing test → owning page object
→ ARIA snapshot of the page → model returns a single patched locator line.
Always writes a `.pre_heal` backup. Contract: the reply is either
`FILE: <path>` plus the full corrected file, or `NO_FIX` plus a reason.
**Done when:** we break an `#add-to-cart-...` locator in a page object, the run
goes red, `npm run heal -- --site saucedemo` patches it, and the re-run goes
green — with the before/after diff printed for the demo.

### [x] Phase 6 — Second site (the multi-domain proof)  (done 2026-08-19)
`config/sites/practicesoftwaretesting.json` + `tests/practicesoftwaretesting/`
conftest wiring. **No file under `src/` may be modified.** If one must be, the
abstraction leaked — fix the abstraction and note it here.
**Done when:** `capture → plan → generate → run` completes for the new site and
`grep -ri saucedemo src/` is still empty.

### [x] Phase 7 — Demo polish  (done 2026-08-19)
`README.md` with the narrative plus a `npm run demo` that walks the whole loop,
a cost report (`npm run usage`) showing requests, tokens and `$0.00` total, and
a short "what a small free model gets wrong" honesty section.

### [ ] Phase 8 — OPTIONAL: agentic browsing
Own MCP tool loop (`@modelcontextprotocol/sdk` client + `@playwright/mcp`)
feeding the free model the accessibility tree as tools. Only after Phase 7, and
only if the daily request budget allows.

## 7. SauceDemo facts — VERIFIED LIVE 2026-08-19

Captured from the real site in Phase 2 (7 pages in `.ai_context/`), not from
memory. Where the pre-capture hypothesis was wrong it is called out, because
those are exactly the mistakes a model will also make.

**Prefer `data-test` over classes.** The current site carries `data-test` on
essentially every element (`[data-test="username"]`, `"password"`,
`"login-button"`, `"shopping-cart-link"`, `"shopping-cart-badge"`,
`"product-sort-container"`, `"inventory-item"`, `"inventory-item-name"`,
`"title"`, `"error"`, ...). The generator prompt must say so — class-based
locators like `.inventory_list` still work today but are the fragile choice,
and `data-test` is what the healer should converge on.

- **Users** (printed on the login page itself): `standard_user`,
  `locked_out_user`, `problem_user`, `performance_glitch_user`, `error_user`,
  `visual_user`. Password for all: `secret_sauce`.
- **Login:** `#user-name` / `#password` / `#login-button` all still exist, and
  each also has a `data-test`. The login button is an `input[type=submit]`,
  not a `<button>`.
- **Login error:** `h3[data-test="error"]`, text
  `Epic sadface: Sorry, this user has been locked out.`; a dismiss button
  `[data-test="error-button"]`; both inputs gain the class `error`.
  *Hypothesis was wrong:* there is no `.error-message-container` wrapper in the
  captured tree — the `h3` is the anchor.
- **Inventory:** `[data-test="inventory-list"]` / `.inventory_list`, items
  `[data-test="inventory-item"]`, names `[data-test="inventory-item-name"]`,
  sort `select[data-test="product-sort-container"]` with the currently applied
  option echoed in `span[data-test="active-option"]`.
- **Item ids do NOT follow list position.** Sauce Labs Backpack is
  `#item_4_title_link` while Sauce Labs Bike Light (second in the list) is
  `#item_0_title_link`. Never derive an item id from its index — a test that
  does will pass by luck and break on re-sort.
- **Cart:** link `[data-test="shopping-cart-link"]`; the badge
  `span[data-test="shopping-cart-badge"]` **only exists while the cart is
  non-empty** (assert absence, not empty text, for an empty cart). Buttons flip
  between `#add-to-cart-<slug>` and `#remove-<slug>`.
- **Checkout:** `#checkout` → `#first-name`, `#last-name`, `#postal-code`,
  `#continue` → summary `.summary_info` → `#finish` → `.complete-header`.
- **Burger menu:** `#react-burger-menu-btn` opens, `#react-burger-cross-btn`
  closes; items `#inventory_sidebar_link`, `#about_sidebar_link`,
  `#logout_sidebar_link`, `#reset_sidebar_link`. **Trap:** the menu links are
  always present in the DOM (inside `.bm-menu-wrap`) and even report a non-zero
  bounding box while the menu is closed, because it is translated off-canvas.
  So presence proves nothing about the menu being open — click the toggle
  first, and assert on `.bm-menu-wrap` state rather than on link existence.
- **State persists across pages and tests** (the cart lives in the session).
  Hence `resetState` in the descriptor: open menu → Reset App State → reload.
  A generated suite must do the same between tests or ordering will bite.
- Credentials go in `.env` as `SAUCEDEMO_USER` / `SAUCEDEMO_PASS` — they are
  public demo credentials, but keeping them out of the descriptor keeps the
  "credentials live in env" pattern honest for real products.

Two capability additions the real site forced into the descriptor format, both
generic and reusable for site #2:
- `resetState` — actions that return the app to a clean state, run before every
  authenticated capture.
- a page with **no `path`** — the `before` steps produce the state and a
  navigation would destroy it (used for `login_error`), plus `optional: true`
  on an action for things like a close button that may not be there.

## 7b. Environment facts learned the hard way (2026-08-19)

- **The node and python Playwright packages each demand an exact chromium
  build.** `playwright==1.49.1` (python) wanted build 1148 while node 1.62.1
  had downloaded 1234 — the suite could not launch a browser even though the
  cache was full of chromium builds. Fix: keep the python pin in the same minor
  as the node dependency (`playwright==1.62.0` + node `1.62.1`), so one browser
  download serves both. `requirements.txt` and `package.json` must be bumped
  together.
- **A "browser is installed" check that only looks at the cache directory is
  worthless** — it was green while nothing could start. `doctor` now launches
  chromium for real, once from node and once from python. Any check that does
  not exercise the thing it claims to verify will eventually lie.
- **pytest JUnit XML: a regex for `name="..."` also matches `classname="..."`.**
  The healer needs a leading-boundary match, or every failure gets labelled with
  its module name.
- `python-dotenv` is a real dependency of the suite: `tests/conftest.py` reads
  `.env` for site credentials.

## 7c. Site #2 (Toolshop) — verified live 2026-08-19

Reached green in one sitting: `config/sites/practicesoftwaretesting.json` +
a three-line `tests/practicesoftwaretesting/conftest.py`, then
capture -> plan -> generate -> test. **4/4 pytest green** on `product search`.

Verified facts:

- Sign-in at `/auth/login`, seeded accounts published in the upstream repo
  README (`customer@practicesoftwaretesting.com` / `welcome01`). Controls:
  `[data-test="email"]`, `[data-test="password"]`,
  `[data-test="login-submit"]` (an `input[type=submit]`).
- Signed-in state is proven by reaching `/account` (title "My account"); the nav
  simply drops `[data-test="nav-sign-in"]`. There is no user-menu element to
  wait on, so `auth.readySelector` is `[data-test="page-title"]`.
- The catalogue offers stable handles: `[data-test="search-query"]`,
  `search-submit`, `search-reset`, `sort`, `product-name`, `search-caption`,
  `search-term`, `search-result-count`.

### The two traps this site sprang, and what they cost

**1. Data-generated selectors.** Product and category handles are
`[data-test="product-01M0DFEWKB8CTRGJMCZE9HRY50"]` — ULIDs from the seeded
database. They work today and are worthless after the next reseed, and the
planner will use them happily because they are the most specific thing on the
page. **This leaked the abstraction:** the fix needed a new capability in the
engine, `unstableSelectors` in the descriptor (regex patterns) honoured by
`src/lib/context.ts`, so such selectors never enter the catalog the planner is
allowed to draw from. That is ~10 lines in `src/`, and it is generic — no file
under `src/` names a site, and the grep guard is still clean. Recording it
honestly: **the "one JSON file, zero engine changes" claim held for everything
except this, and this was worth changing the engine for.**

**2. A `ready` selector that also matches the loading skeleton.** While the API
call is in flight the app renders eight placeholder cards that already carry
class `card`. `ready: ".card"` therefore resolved instantly and the capture
recorded the SKELETON: 31 elements, zero products, empty `heading [level=5]`
nodes — and not a single warning, because from the harness's point of view
everything succeeded. Probing the live page settled it: at `domcontentloaded`
there are 8 sized-but-empty cards and 0 `[data-test^="product-"]`; after
`networkidle`, 9 cards and 27 product elements. The fix is descriptor-level —
`ready: [data-test="product-name"]`, which only a real card has — and the
capture went from 31 to 95 elements. **Lesson worth keeping: a readiness signal
must discriminate loaded content from its own placeholder, or the whole pipeline
plans against a skeleton and never finds out.**

### Remaining honest weakness

The generated assertions hardcode counts drawn from the capture
(`"4 products found for 'pliers'"`). They are real assertions, not vacuous
ones, but they are coupled to seeded data — a reseed with different tools would
turn them red, and the healer would then be asked to "fix" a data change. A
future phase could teach the planner to prefer relative assertions (result
count matches the number of cards) over absolute ones.

## 7d. Generator hardening + the free-tier ceiling (2026-08-19, second features)

Adding a second feature to a site that already had one exposed two real defects
in the engine and one hard limit in the free tier.

### Two gate gaps, both now closed

**A test can invent a Playwright API and every gate misses it.** The generated
cart suite called `app.expect_to_have_url(...)`. No such method exists. It
compiled, it used no locator, so nothing rejected it — it died at runtime with
`AttributeError`. The fix is structural rather than a list of allowed methods:
in a test file the fixture may ONLY be passed to a page-object constructor, and
`expect(` may not appear at all. Both are now validated, which also enforces the
style the reference sample teaches.

**A second feature silently deleted the first feature's page-object methods.**
Generating the cart suite rewrote `models/inventory_page.py` and dropped the two
methods `test_login.py` called. Five green tests went red without being touched;
`git checkout` of the staged file was what saved them. Now: the page objects for
the screens a plan touches are included in the generator prompt with
"extend, do not replace", and a gate rejects any produced file that loses a
`def` the on-disk version had.

Those two fixes then **contradicted each other** — the carried-over file legally
contains selectors from the earlier plan, which the selector gate rejected as
"not in the plan", while the member-loss gate demanded they stay. Reconciled by
allowing, for an existing file, the union of the plan's selectors and the ones
already in that file. Worth remembering: gates added independently can make a
task unsatisfiable, and the model then loops until the repair budget runs out.

### The free-tier ceiling is real, and it moves

Timeline from one evening, same model, same machine:

| Prompt | Model | Result |
|---|---|---|
| 6.1k chars | laguna-s-2.1:free | answered in 49s |
| 13.7k | laguna-s-2.1:free | answered in ~35s |
| 16.8k | laguna-s-2.1:free | 3 timeouts (4 min each) -> fell back to cohere -> 3 more timeouts -> router served it with laguna-**xs** |
| 19.8k | laguna-s-2.1:free | never served |
| 11.8k | laguna-s-2.1:free | never served (an hour after the 13.7k success) |
| 11.8k | glm-5.2:free | HTTP 429 from the provider |

Two conclusions. **The size limit is not published and not stable** — the same
endpoint that served 13.7k an hour earlier would not serve 11.8k later.
**And the fallback chain is a quality risk, not just a latency one:** the router
handed the job to a much smaller sibling model, and that is precisely the run
that produced the invented Playwright API.

Mitigations applied, in order of value:
1. **Send less.** The generator now gets the plan's mechanics without the
   planner's prose (-18%), and only the page objects for screens the plan
   touches, not all of them.
2. **Split a feature rather than grow it.** `plans/saucedemo_cart.json` and
   `plans/saucedemo_checkout.json` were split out of the 5-test plan locally, at
   zero model cost, purely to shrink the generation request. **Practical rule
   for the free tier: about three tests per plan.**
3. **Fewer retries, not longer ones.** A timeout means the endpoint is busy;
   retrying it three times at four minutes each only delays the fallback.
4. **Swap the model in config, not in code.** One line in
   `config/ai.config.json` moves the generator role to another free model.

## 7e. The vacuous assertion came back, wearing a page object

Worth its own section because it is the most instructive failure of the build,
and because the first version of it shipped green.

The first `contact form validation` suite passed 3/3 and proved nothing. Every
test ended in the same call, `expect_on_contact()`, whose body asserts the URL
still contains `/contact` — which is true before and after any submission, valid
or invalid. The plan behind it asserted `expect_url: /contact` plus
`expect_visible` on form fields that are always visible.

**Why the gates missed it.** The vacuous-URL rule only rejects a value with
fewer than two non-slash characters, so `/contact` passed. The "every test needs
an expect_*" rule was satisfied. And the weak check sat inside a page-object
method, where nothing inspects its body.

**The real root cause was mine, not the model's.** The captured `contact` page
contains no error elements at all — the validation alerts only exist after a
failed submit, and I had never captured that state. Handed a catalogue with
nothing failure-shaped in it, the planner asserted on the only things it could
see. **The capture sets a ceiling on how good an assertion can be.**

The fix, in order:
1. A `contact_error` page in the descriptor: no path, before-steps submit the
   empty form, ready on `[data-test="message-error"]`. Its alerts are per field
   with their own text (`first-name-error` -> "First name is required", ...).
   A short `wait` was needed too — the alerts do not all render in one frame,
   and the first capture caught two of five.
2. Re-plan, re-generate. The suite now asserts each field's error text, and the
   valid-data test asserts every error is absent. Still 3/3 green, but now for
   a reason.
3. Two permanent hardenings so the class is less likely to recur: a planner rule
   that an assertion must be about something that became true *because* of the
   steps, and a validator gate rejecting two tests in one plan whose assertion
   sets are identical.

Neither hardening would have caught this specific case on its own. The honest
lesson is the capture rule: **if you want tests that can fail, capture the state
where the application fails.**

## 7f. Second round of features (2026-08-20) — and the prompt-size fix that stuck

Added `checkout` to site #1 and `sign in` to site #2. Both green. Two things
learned that were not visible yesterday.

### The time of day is a real variable

Yesterday evening the planner would not serve prompts above about 12k characters.
This morning the same model answered a **14.4k** planner prompt in 60 seconds
without a retry. Same machine, same key, same code. If a generation stalls,
retrying in the morning is a legitimate first move — and it costs nothing.

### JSON was a third of the generator prompt

Measured the prompt instead of guessing (worth repeating as a habit — the
composition was not what I assumed):

| Section | Size |
|---|---|
| plan, as pretty-printed JSON | 4.5k |
| few-shot reference files | 3.3k |
| existing page objects | 3.1k |
| rules + scaffolding | 3.3k |
| selector notes | 0.6k |

Pretty-printed JSON spends five lines and a dozen braces per step, and the model
needs the steps, not the punctuation. `slimPlan()` now renders one line per step
(`12. click  [data-test="checkout"]`), which took the 37-step checkout plan from
4.5k to 2.5k and the whole prompt from 15.4k to 13.6k. Nothing the model uses
was removed.

13.6k still would not be served, so the checkout plan was split into
`checkout_order` (1 test, the full purchase) and `checkout_cancel` (2 tests) —
12.2k, generated first try in 17 seconds. **The three-tests-per-plan rule from
§7d holds; step count matters more than test count.**

### Quality of the new suites

`test_checkout_order.py` is the best-asserted suite the pipeline has produced:
it verifies the cart contents, then `Item total: $29.99`, `Tax: $2.40`,
`Total: $32.39` — i.e. it actually checks the tax computation — and finally the
`/checkout-complete.html` URL, which genuinely changes. Data-coupled to a fixed
product price, so stable.

`test_sign_in.py` (site #2) asserts the real error text
("Invalid email or password") for a rejected attempt and a changed URL plus the
account title for a successful one. This is the §7e lesson applied prospectively
rather than after the fact: the `login_error` state was already captured, so the
planner had something failure-shaped to assert on and produced honest tests on
the first plan.

## 7g. Four of the gates were dead (2026-08-20) — and nothing said so

The worst finding of the build, and the reason `npm run gates` now exists.

A generated cancel-checkout test called `expect(app).to_have_url(...)` directly
in the test body — something two separate gates were supposed to reject — and it
was accepted on the first attempt. Chasing that produced a much bigger problem
than one bad test.

**Cause 1: a shell edit wrote a control character into a regex.** An attempt to
insert the two characters `` into `/(app|guest)\.(\w+)/` via `perl -pe`
inserted a literal **backspace byte (0x08)** instead. The regexes became
`/<BS>(app|guest)…/` and `/<BS>expect\s*\(/`, which match nothing. The source
*looked* right in an editor; only `cat -A` revealed `^H`.

**Cause 2: two other gates were never in the file at all.** Several `python -
str.replace()` patches printed a success message unconditionally while the
replacement silently failed to match (line endings and escaping). The
member-loss gate that §7d claims was added yesterday **was never actually
there** — only the prompt instruction was, which is why the model mostly
behaved. Corrected here rather than left standing.

**Why it went unnoticed for a day: a gate that cannot fire produces exactly the
same output as a gate that passes.** Every run printed "generated on the first
attempt". Silence read as approval.

### The fix that matters

`npm run gates` (`src/tools/gate_check.ts`) feeds every gate an input it MUST
reject, plus sound inputs it must accept — 15 cases. It found the two missing
gates immediately, which is the whole point: **the validations that guard
generated code need tests of their own, or they rot invisibly.** Run it after
touching `validateFiles` or `validatePlan`, and add a case with every new gate.

Two smaller lessons worth keeping:
- **Never patch source with shell string-replacement.** Use an editor that
  fails loudly when the target text is not found. Every silent-failure bug in
  this build came from the same habit.
- `run_generator.ts` now guards its `main()` behind an argv check, like
  `snapshot.ts` — importing a module to test it must not start a generation.

### The interface experiment, and why it was reverted

Trying to shrink the prompt, I sent existing page objects as interfaces
(signatures, no bodies) instead of full source. It saved 2.3k characters and
broke a green test in one run: shown only `def expect_url(self)`, the model
wrote a plausible body asserting the wrong URL. Reverted. Prompt size is worth
optimising right up to the point where the model starts guessing at existing
behaviour — and the body-preservation gate now catches that class regardless.

## 7h. Open design flaw: whole-file regeneration does not scale

Discovered while trying to add a fourth feature to site #1, and left open
deliberately rather than papered over.

The generator's contract is whole-file: the model returns the complete contents
of every page object a plan touches. That worked for one or two features and
fails at four, for two reasons that pull in opposite directions:

- **The prompt grows with the suite.** Every existing page object the plan
  touches must be shown so the model does not delete or alter it. Four page
  objects took the cancel-checkout prompt to 14.8k characters — past what the
  free endpoint serves.
- **Byte-identical reproduction is too much to ask.** With the body-preservation
  gate live, the model must reproduce four files exactly and add to them. It
  could not: the first attempt changed four method bodies, and the repair round
  produced sixteen problems instead of fewer. The gate is right about intent and
  wrong about mechanism — it demands work the model is bad at.

**The fix (not implemented): make the generator append-only.** Ask for NEW files
and NEW methods only, and let the harness merge additions into existing page
objects. That removes deletion, body rewriting, and the reproduction burden in
one move, and shrinks the prompt instead of growing it. The body-preservation
gate then becomes trivially satisfiable, because the model never touches an
existing member.

Consequence for now: `plans/saucedemo_checkout_cancel.json` remains ungenerated.
An earlier attempt did produce `test_checkout_cancel.py`, but only because the
gates were dead at the time (§7g) — it called `expect(app)` directly and failed
at runtime. **That file was deleted rather than kept: code that passed only
because validation was broken is worse than no code.** Practical workaround
until the refactor: a plan whose screens are already covered by existing page
objects generates cleanly at three tests or fewer, provided few page objects are
involved.

## 7i. The generator is append-only now (2026-08-20) — §7h resolved

The design flaw in §7h is fixed, and the fix is the most useful thing in this
repository. Read §7h first for why the old contract failed.

### The contract

The model no longer returns whole page objects. It returns:

- `=== FILE: models/x_page.py ===` — a complete NEW file, for a screen with no
  page object yet;
- `=== ADD TO: models/x_page.py ===` — only the locator attributes and methods to
  be **added** to a screen that already has one.

`mergeAddition()` places them mechanically: locator lines after the last existing
locator in `__init__`, methods at the end of the class. The model never sees, and
so never rewrites, an existing implementation.

### What that bought

| | whole-file | append-only |
|---|---|---|
| prompt, 4 page objects | 14.8k chars — refused by the endpoint | **10.0k, served in 9s** |
| can delete another suite's method | yes, and did | structurally impossible |
| can change what a method does | yes, and did | structurally impossible |
| existing page objects shown as | full source (grows with the suite) | interfaces (roughly flat) |

Verified: `product sorting` generated first try, extended the shared
`inventory_page.py`, and site #1 went from 8/8 to **11/11 with no regression** —
the exact scenario that broke a green suite twice under the old contract.

The three accumulated gates did not go away; they became assertions that pass
trivially. That is what a good invariant looks like.

### Four smaller fixes the refactor surfaced

1. **`__init__` must be allowed to grow.** The body-preservation gate flagged it
   immediately, because adding a locator legitimately changes it. For that one
   method the rule is now "nothing removed" rather than "nothing changed".
2. **A repair prompt has to carry the whole original request.** Every call is
   stateless, and `generatorRepair()` was sending only the error list — asking the
   model to redo the work from nothing. It showed: a second repair round invented
   a `tests/` path prefix nobody had mentioned. It now re-sends the full prompt,
   the previous attempt, and the errors last.
3. **Never spend a request on something the harness owns.** The planner used to
   reject a whole plan because the model wrote `"product-sorting"` where the CLI
   asked for `"product sorting"` — a field `run_planner.ts` overwrites two lines
   later. On a 50-requests-a-day budget that is pure waste.
4. **Models close what they open.** One reply ended with `=== END ===`, which
   landed in the .py file and cost a repair round to a SyntaxError. The parser now
   drops any unrecognised marker-shaped line.

### Two new tools

- `npm run gates` — 20 cases proving every validation still fires (see §7g).
- `npm run batch -- --file batches/<name>.json` — plans and generates several
  features in sequence, checking the daily request budget before each one and
  stopping rather than starting a feature the budget may not cover. Failures are
  reported, not fatal.

### Capture additions that make more features possible

Captures cost no model requests, so breadth here is free. Added: site #1
`cart_two_items` and `inventory_sorted`; site #2 `register`, `register_error`,
`forgot_password`, `forgot_password_error`, `favorites`, `profile`, `invoices`,
`messages`. Both descriptors also record their sort control's option VALUES in
`facts`, because those are not recoverable from a capture and a planner that
guesses them writes tests that select nothing.

One prompt-side consequence: a registration form with a country dropdown produced
330 accessibility-tree lines, nearly all `- option "..."`. `trimAria()` now
collapses runs of identical node types and caps the tree, leaving the selector
catalogue complete.

## 7j. Scaling up: what breaks when you add features in bulk

Once the append-only contract was in, the bottleneck moved from "can this
generate at all" to "what goes wrong on the tenth feature". A `npm run batch`
run over seven queued features exposed four more gaps, all now closed.

**One canonical selector per element.** The capture used to offer both
`#add-to-cart-x` and `[data-test="add-to-cart-x"]` for the same button. Two
features then picked different forms for the same element, and the generator —
sensibly following the style already in the page object — produced a locator the
new plan had not sanctioned. `selectorsFor()` now emits exactly one form per
element: data-test, else id, else class. It also cut a two-page planner prompt
from 26.3k to 17.7k characters.

**Show every existing page object, not the "relevant" ones.** Filtering them by
the plan's page names looked tidy and cost a repair round: a capture named
`cart_two_items` describes the same screen as `cart_page.py`, so the model was
never shown that file existed and dutifully sent it as new. Interfaces are small;
guessing which ones matter is not worth hiding one.

**A test may not call a page-object method that does not exist.** A generated
test called `cart.remove_bike_light()`, which the model never added. It compiled,
used no locator, broke no other rule — and died with `AttributeError`. Now
validated statically: the test file's `x = SomePage(app)` bindings are matched
against the methods present in the resulting page object, whether they were
already there or added in the same reply.

**A repair prompt must carry the whole request** (see §7i.2) — this was found
here, when a second repair round invented a `tests/` path prefix that had never
been mentioned.

### On using a batch runner at all

`npm run batch -- --file batches/<name>.json` is worth having for one reason
beyond convenience: it checks the daily request budget before each feature and
stops rather than starting one the budget may not cover. A half-generated feature
is worse than a missing one. It also keeps going after a single feature fails,
so one refused endpoint does not throw away the features that worked.

## 7k. Playwright strict mode, and using the capture as a type system

`test_catalogue_sorting` failed on all three of its assertions with a strict-mode
violation: `[data-test="product-name"]` matches every product card, and
`expect(locator).to_be_visible()` on a nine-element locator is an error in
Playwright, not a loose match. The generated page object had no `.first`.

The fix is the interesting part. **The capture already knows how many elements a
selector matched** — that information was sitting in the selector inventory and
being thrown away. Now:

- `selectorNotes` annotates every multi-match selector with
  `MATCHES 9 ELEMENTS — chain .first (or .nth(i)) …`;
- a gate rejects a page object that assigns such a selector without `.first` /
  `.nth(` / `.last` and then asserts on it singularly.

That is the general lesson worth keeping from this whole exercise: **the capture
is not just a selector list, it is the only ground truth available, and every fact
in it that the model would otherwise have to guess should be handed over
explicitly.** Element counts, option values, which state shows an error — each one
guessed wrong produced a red test; each one stated produced a green one.

## 7l. Prompt budget, round three (2026-08-21)

A morning where the endpoints were simply bad — the planner would not serve 13.1k
when it had served 14.4k the previous day — so the work went into the three things
that are actually under my control.

**Shared selectors are sent once.** Two captured pages of the same site repeat all
the site chrome: navigation, header, footer. `sharedSelectors()` computes the
intersection across the captures in a plan, lists it once as legal everywhere, and
each page section then carries only what distinguishes it. A two-page planner
prompt went **18.1k → 12.8k** with nothing removed.

**The few-shot example is two files, not three.** The third was a second page
object that only demonstrated an import. It now also shows a `.first`-chained
locator, so the strict-mode rule has a worked example rather than only a
prohibition.

**The router comes second in every fallback chain.** It used to be last, after a
list of named models — which meant a bad afternoon spent twenty minutes
discovering that each named endpoint in turn was down. `openrouter/free` picks
whichever free model is actually serving, so the chain is now: preferred model,
then let the router decide, then named models as a last resort.

Cumulative effect on the generator prompt for one feature, across all three
sessions: **15.4k → 10.0k**, while the suite it has to be aware of grew from two
page objects to six.

## 7m. The free-tier limit is token-weighted, not request-weighted

The most useful thing learned on a day when nothing generated at all.

`npm run probe` (new — `src/tools/probe.ts`) sends one four-token request to each
configured model and reports what is actually serving. On the afternoon in
question it said, unambiguously:

```
    3024ms  nvidia/nemotron-3-nano-30b-a3b:free
    3110ms  poolside/laguna-s-2.1:free
    3992ms  nvidia/nemotron-3-ultra-550b-a55b:free
   13320ms  openrouter/free
```

Every endpoint I needed was up and fast. Yet the same `poolside/laguna-s-2.1:free`
that answered four tokens in 3.1 seconds returned **HTTP 429** for a
12.2k-character prompt, and `nemotron-3-ultra` timed out on 12.3k after answering
a tiny prompt in 4 seconds.

**So the upstream limit is weighted by tokens, not by requests.** A large prompt is
not merely slower — it is more likely to be refused outright, and swapping models
does not help because they share the same congested capacity. That reframes every
size optimisation in §7d, §7f, §7i and §7l: those were not working around a fixed
ceiling, they were reducing the token cost of each request against a rate limit
that moves with load.

Practical consequences, in order of value:
1. **Prompt size is the lever, model choice is not.** Do not go shopping for
   another free model when a request is refused; make the request smaller, or wait.
2. **`npm run probe` tells you which it is.** If probe is fast and real work is
   refused, the problem is your prompt size, not availability. If probe is slow
   too, stop and come back later — the budget is better spent then.
3. **Retry timing beats retry count.** Mornings served 14.4k prompts without a
   single retry; the same prompts were refused all afternoon.

Cumulative trimming so far, none of which cost any prompt quality:
planner **18.1k → 11.9k** (shared selectors listed once, accessibility tree capped
at 40 lines), generator **15.4k → ~11k** (one line per plan step, page objects as a
name index, two-file few-shot, rules compressed).

### What this cost, honestly

14 requests spent on this day's attempts with **nothing generated**. The right call
would have been to run `npm run probe` first, see the 429s for what they were, and
stop after two attempts instead of nine.

## 7n. Six single-request probes, and what they settled (2026-08-21)

After a day of learning nothing from nine multi-attempt runs, the method changed:
send **one** request, with no retry and no fallback, and read the answer. `--once`
on both `run_planner` and `run_generator` does that; the canary sends the REAL
next request, so a success is finished work rather than a measurement.

| # | Request | Size | Reached the model? | Reply accepted? |
|---|---|---|---|---|
| 1 | planner, named model | 12.2k | no — "Upstream error from Nvidia: Service temporarily overloaded" | — |
| 2 | planner, `openrouter/free` | 12.2k | **yes** | **yes** — 3 tests planned |
| 3 | generator, named model | 12.0k | no — timeout | — |
| 4 | generator, `openrouter/free` | 12.0k | **yes** | no — 5 gate violations |
| 5 | repair, `openrouter/free` | 16.5k | no — timeout | — |
| 6 | repair, `openrouter/free` | 8.8k | **yes** | no — 8 gate violations |
| 7 | repair, `openrouter/free` | 11.2k | **yes** | no — 9 gate violations |
| 8 | fresh generation, 2-test plan | 11.1k | no — timeout | — |

### What that settles

**A `--once` canary is worth more than a retry loop.** Probe 1 produced an error
message nine multi-attempt runs never showed: the provider saying plainly that it
is overloaded. Retries had been converting a precise diagnosis into a vague
timeout. **The retry logic was hiding the evidence.**

**Two questions were being blurred into one.** "Did the endpoint serve this" and
"was the answer any good" are different failures with different fixes. `--once`
now reports them separately, and probes 4 and 6 are cases where the endpoint was
fine and the reply was not.

**The serving threshold today is between 12k and 16.5k, via the router only.**
Named models refused 12k twice; the router served 12k twice and refused 16.5k.
Model choice does not beat prompt size — but it does decide whether ~12k is
served at all.

**The repair was the request that could never fit.** A repair prompt carried the
original request plus the previous reply, so a 12k generation implied a 16.5k
repair — guaranteed refusal. **The budget has to be set by the repair, not by the
first attempt**, and that had been invisible because the retry loop reported the
whole thing as one failure.

### The fix, and the mistake inside the fix

`generatorRepair()` was rewritten to carry only what a repair needs: the plan, the
files that were wrong, the errors, and a compressed rules reminder — no few-shot
example, no page-object index unless an error names an existing file. **16.5k →
8.8k**, smaller than the generation it repairs.

Then probe 6 came back with *more* problems than probe 4: eight against five, and
three of them were the plan's tests simply **missing**. Cause: "only the files an
error names" excluded the test file, because none of the five errors mentioned it
— and the instruction still said "re-send every file". The model re-sent what it
could see, and produced a test file with no tests in it.

Same shape as the interface experiment two days earlier: **a size optimisation
works right up to the point where it removes context the model cannot reconstruct.**
The test file is never optional in a repair; page objects are included only when
implicated. Fixed and covered by the gate suite.

### The ledger was lying, and now is not

`record()` only ran on success, so six requests sent showed as four. Every budget
decision for three days was made on optimistic numbers. Failures are now recorded
with their reason, and `npm run usage` has a `failed` column. This is my own
accounting defect, not a free-tier one.

### Probe 7: repairing the newest reply compounds the damage

Probes 4, 6 and 7 went 5 -> 8 -> 9 problems, and that was not the models getting
worse. `lastReplyFor()` picked the NEWEST saved reply, and the newest was the
worst: probe 7 repaired probe 6's reply, which had already lost the plan's three
tests, so it inherited and carried forward the damage.

Fixed: `bestReplyFor()` scores every saved reply for the feature and repairs the
one with the fewest problems, newest breaking a tie. **When replies can degrade,
"latest" is the wrong selection rule.**

### Probe 8: a smaller plan is a weak lever, and there is a floor

Trimming a validated plan from three tests to two — done locally, at no model
cost — moved the generator prompt from 12.0k to **11.1k**. Thirty-three per cent
fewer tests bought seven per cent fewer characters, because the fixed parts (the
rules, the few-shot example, the page-object index, the selector notes) are about
9k of the 11k and one test's steps are under a kilobyte.

And 11.1k was **refused**, half an hour after 11.2k and 12.0k had both been
served. So there is no stable threshold to engineer against — the capacity moves.
Everything that was served today happened between 14:07 and 14:45; nothing before
or after it went through.

**Conclusion on prompt size: it was worth doing and it is now finished.** Planner
18.1k -> 11.9k, generator 15.4k -> 11.1k. Below roughly 11k there is nothing left
to remove that the model does not need — twice now, cutting further removed
context it could not reconstruct (the method bodies, then the test file).

### The day's honest total

**20 requests, 3 served, 0 new tests.** What improved is the engine: the `--once`
canary, `--repair-from-last`, best-reply selection, a repair prompt smaller than
the generation it repairs, a ledger that counts failures, and `npm run probe`.
Plus two defects that the retry loop had been hiding for three days.

### Open trade-off, not yet decided

The router keeps the pipeline moving but picks the model. On these probes it chose
`nemotron-3-super-120b`, which writes visibly worse code than
`poolside/laguna-s-2.1` — strict-mode mistakes and rewriting existing method
bodies. **Availability and quality are in tension**, and which to prefer is a
judgment call: the gates catch the bad output either way, but each rejection costs
a request.

## 8. What the operator must provide

1. **OpenRouter account + API key** — openrouter.ai, sign in with Google/GitHub,
   Keys → Create Key, no card needed for `:free` models. Put it in `.env` as
   `OPENROUTER_API_KEY=`. Blocks Phases 1, 3, 4, 5.
2. **Privacy toggle decision** — Settings → Privacy: free endpoints need
   "providers that may train on your data" enabled. Fine for this repo (public
   demo content only), but it is a conscious choice.
3. Nothing else. Playwright browsers install locally in Phase 0.

## 9. Session handoff

Keep this current — a fresh session reads it first.

**Last updated:** 2026-08-20 (third session).

### Where the suites stand

| Suite | Site | Result |
|---|---|---|
| `test_login.py` | #1 | 5/5 |
| `test_cart.py` | #1 | 2/2 |
| `test_checkout_order.py` | #1 | 1/1 |
| `test_product_sorting.py` | #1 | 3/3 |
| `test_product_detail.py` | #1 | 2/3 |
| `test_cart_with_several_items.py` | #1 | 2/3 |
| `test_product_search.py` | #2 | 4/4 |
| `test_contact_form_validation.py` | #2 | 3/3 |
| `test_sign_in.py` | #2 | 2/2 |
| `test_password_reset_request.py` | #2 | 1/1 |
| `test_registration_validation.py` | #2 | 1/3 |
| `test_catalogue_sorting.py` | #2 | 0/3 |

**26 green, 6 red, 12 suites, 9 features.** Every red test is the planner or the
generator missing a fact the harness could have supplied — and each of those facts
is now either in a descriptor or enforced by a gate:

1. an add-to-cart control is REPLACED by a remove control, not relabelled
   (descriptor `facts`, site #1);
2. a test called a page-object method nobody added (gated, §7j);
3. + 4. the registration form validates every required field at once, so a partial
   fill still shows the others' alerts (descriptor `facts`, site #2);
5. + 6. + one more: a singular assertion on a selector matching nine product cards
   is a Playwright strict-mode violation (annotated in the prompt AND gated, §7k).

### Next action

```
npm run batch -- --file batches/repairs.json   # re-plans all four affected features
npm run test  -- --site saucedemo
npm run test  -- --site practicesoftwaretesting
```

About 12-16 requests. `batches/round3b.json` also still has
`account area navigation` unattempted — its generation failed on a syntax error
after two repairs, and the plan is on disk to retry alone.

### The rules that keep costing money when forgotten

- Run `npm run gates` after touching any validation, and add a case with each new
  gate. Four gates were once dead simultaneously (§7g).
- Never patch source with shell string-replacement; use an editor that fails
  loudly on a missed match.
- Keep a plan at about three tests. Mornings serve larger prompts than evenings.
- Captures are free — add pages generously before spending requests on planning.
  A capture that lacks the failure state guarantees a test that cannot fail (§7e).
- Record app behaviour in the descriptor `facts` as soon as a test reveals it. All
  four red tests above are the planner not knowing something the descriptor could
  have told it.

### Reading order for a cold start

§7 (site #1 facts), §7b (environment), §7c (site #2 + the leaked capability),
§7d (free-tier ceiling), §7e (the vacuous assertion), §7f (prompt composition),
§7g (four dead gates), §7h (why whole-file regeneration failed), §7i (the
append-only contract that replaced it), §7j (what broke when adding features in
bulk). That is the whole hard-won part; the rest is in the code.

## 7o — Probes 9-19: the guardrails were the problem

Fourteen more single requests, 2026-08-21 afternoon. It began as "has capacity
returned" and turned into an audit of my own tooling. The generator now produces
a green suite on the first attempt; nearly every fix was on my side of the wire.

### The scoreboard

| Probe | Prompt | Served | Problems reported |
|---|---|---|---|
| 9  | 11.1k, router  | yes, 77s   | 7 |
| 10 | 11.1k, 550B pinned | yes, 116s | 7 (different in kind) |
| 11 | 10.5k, 550B | yes, 31s | 2 |
| 12 | 10.4k, 550B | yes, 50s | **0** — 1 of 2 tests then failed in pytest |
| 13 | 10.6k, 550B | yes, 26s | 1 (caught by the new gate) |
| 14 | 11.6k, 550B | no  | — |
| 15 | 10.4k, 550B | no  | — |
| 16 | 10.4k, router | yes, 10s | 1 |
| 17 | 4.5k repair, router | no | — |
| 18 | 4.5k repair, router | yes, 14s | 0 — pytest then failed on a type |
| 19 | 10.5k, router | yes, 175s | **0, and 2/2 green in pytest** |

### The router picks model SIZE, not just availability

Probe 9 was served promptly by `nemotron-nano-9b-v2` — a 9B. On the two previous
days the same role was answered by a 550B and a 118B. Requesting
`openrouter/free` is a lottery over capability, and the ledger's `model` column is
the only way to know which ticket you drew. `askModel` now takes a `model` to pin
one endpoint, because "was this a capacity problem or a size problem" cannot be
asked without it.

Two failure modes, cleanly separated by size:
- **9B**: incoherence — the test called four methods the same reply never defined.
- **550B**: format disobedience — a coherent test, but it rewrote `__init__`
  instead of adding to it. Closer to fixable, because it understood the task.

### Six of seven "problems" were mine

Re-judging the two paid replies against fixed gates, spending nothing:

- **The duplicate-member gate forbade `__init__` in an addition** — while the
  contract *requires* `__init__` there, since that is where locators live. The
  model was penalised for obeying the format it had been given. 7 -> 5.
- **Multi-match detection summed across captures.** A cart badge appearing once
  on each of three pages counted as "3 elements on the page", so the prompt
  ordered `.first` on a selector that is unique per page — and a second gate then
  read the added `.first` as "changing an existing locator" and called it a loss
  of lines. One bad count, two violations, both invented. 5 -> 3.
  **When a 9B and a 550B make the identical mistake, suspect the judge.**
- After both fixes the 550B's only independent error was one invented selector.

### The index was withholding what it demanded be reused

Three times in a row, a model "error" was information the prompt had kept back:

1. It needed a locator for the selected sort option, saw the NAME `active_option`
   in the index, could not see that it already pointed at
   `[data-test="active-option"]`, and wrote its own `option:checked`.
2. It called an existing `expect_url()` with a URL argument, because the index
   listed method names without signatures. Every gate passed, the files were
   written, and pytest died on a TypeError.
3. With signatures shown, it passed `2` to `expect_badge_count(count)` — because
   `paramsOf` stripped the annotation `count: str`. Playwright: "value must be a
   string or regular expression".

A name says a thing exists. Only the selector, the parameters and their types say
how to reuse it. **Half an interface is the half that fails.**

### Detail has to be paid for

Spelling out selectors and signatures pushed the prompt 10.6k -> 11.6k and the
request was refused outright. The budget was found by giving files this feature
does not touch a single line — `also on disk, not part of this feature: ...` —
which bought 1.2k. The prompt now carries *more* usable context at 10.4k than it
did at 11.6k.

### But size is not the whole story

Probe 15 was refused at 10.4k, twenty minutes after probes 12 and 13 were served
at the same size and model. Probe 17 was refused at **4.5k**, ten seconds after
10.4k had been served. Availability swings minute to minute, independently of
size. Earlier notes that read "the threshold today is 12k" are too confident:
size shifts the odds, it does not set a line.

### Two runtime failures became deterministic gates

Both pytest failures above are now caught before anything is written:
- **arity**: comparing the call's argument count to the `def` signature.
- **literal type**: a `str` parameter given a bare number, or vice versa. Only
  literal arguments are judged — a variable's type is not knowable at the call
  site, and a gate that guesses is worse than one that stays quiet.

Neither needed a model. Both were arithmetic.

### The invisible byte, a second time

`pageObjectIndex` silently reported every file as irrelevant. Cause: a shell edit
had written a literal **0x08** where `` was intended — the exact failure §7g
records for two dead gates. It is invisible in every editor, in `sed` output, and
in a diff. Compounding it, `['"]([^'"]+)['"]` captured `[data-test=` and stopped
at the first inner quote, so every selector comparison failed.

`npm run gates` now scans `src/` for control bytes. **A guardrail that cannot be
seen to be broken needs a guard of its own** — and this project has now paid for
that lesson twice.

### Where it landed

Probe 19: 10.5k, served in 175s by `nemotron-3.5-lightning`, zero gate
violations, and `test_cart_items.py` **2/2 green in pytest on the first attempt**.
Suite total: 18 of 19 passing on saucedemo, the one red being the pre-existing
`test_product_detail_add_to_cart_toggles_button`.

Requests spent this session: 11 of the day's 46, and the three most useful
verdicts of the day cost nothing at all — they came from `--validate-only`,
which re-judges replies already paid for.

## 7p — The account-area plan: six defect classes caught before they shipped

Next plan after cart_items, chosen because it lives on the OTHER site and touches
seven page objects: `practicesoftwaretesting_account_area_navigation` (3 tests,
8.0k prompt). It is not green. What it produced is more useful than a green run:
every failure below used to reach runtime or ship silently, and each one is now a
deterministic check that costs nothing.

### What the new gates caught

1. **Methods merged at column 0.** The reply sent `def open(self)` flush left in
   an ADD TO block; the merge appended it verbatim, so four "methods" became
   module-level functions and all three tests died on `'AccountPage' object has no
   attribute 'open'`. The gate had passed them because `memberBodies` finds a
   `def` at any indentation — my model of "class member" ignored the one thing
   Python does not. `mergeAddition` now re-indents a flush-left addition (the
   intent is unambiguous; spending a request on an indentation nit is a bad
   trade), and a gate rejects a column-0 `def` arriving via a whole-file block.
2. **An invented Playwright API.** `self.page_title.expect_visible()` — a Locator
   has no such method; `to_*` lives on `expect(locator)`. Compiles, passes every
   other check, dies at runtime. Now flagged, and only for attributes the file
   itself declares as locators, so there are no false positives.
3. **A locator without `self.`** — `nav_favorites = page.locator(...)` at class
   level, where `page` does not exist. `py_compile` checks syntax, not names, so
   this would have failed on *import*.
4. **Arity**, in both directions: `expect_url()` called with an argument when it
   takes none, and with none when it takes one. (The two page objects genuinely
   disagree: `CartPage.expect_url(url)` vs `InventoryPage.expect_url()`. Worth
   harmonising — inconsistent interfaces are a fair reason for a model to guess.)
5. **Literal type**: `2` passed to `expect_badge_count(count: str)`, which reached
   `to_contain_text` and made Playwright throw.
6. **My own notation, copied as code.** The index listed locators as
   `name = selector`; a model wrote `nav_favorites = [data-test="nav-favorites"]`
   into the Python file. Reference material that looks like source gets used as
   source. The listing is now `name  ->  selector`, a shape Python cannot parse.

### A repair must carry the whole previous reply

Sending only the blocks an error named turned one problem into four — twice. The
model returns what it was shown, so three page objects it had written the round
before simply vanished, and a reply is judged as a whole. The prompt-size argument
for trimming never held up either: the repair was 4.9k against a budget near 11k,
so the omission bought nothing and cost a round. Now every block goes back, with
the problem files marked `<-- problems reported in this file`.

### Two ways to spend nothing

- `--validate-only`: re-judge every saved reply for a plan against the current
  gates. Three of the most useful verdicts today came from it.
- `--apply-last`: if a saved reply passes the current gates, write it. When a
  reply was rejected because the *tooling* was wrong, applying the fix should not
  cost a request.

**And a bug in that idea, worth recording.** `--apply-last` set `accepted` and then
fell straight through into the request loop, spending three of the day's requests
re-asking a question it already had the answer to. An early-return path has to
actually return; the loop now checks `!accepted`. The wasted requests were not
entirely wasted — one of those replies became the best saved candidate — but that
is luck, not design.

### Where it stands

- `test_cart_items.py`: **2/2 green, first attempt, no repair** (probe 19).
- saucedemo: 18 of 19 passing. practicesoftwaretesting: 11 of 15.
- The account-area plan remains red: each attempt now fails in a *different*
  place, every failure is caught before anything is written, and the small models
  the router is handing out today (9B-30B) cannot hold four page objects and three
  tests coherently in one reply. The plan is a candidate for splitting into
  one-page-object features.

### The pattern across 7o and 7p

Of roughly a dozen distinct "model errors" examined closely across both sessions,
the majority were mine: a gate contradicting the contract, a count summed across
the wrong axis, an index withholding the selectors and signatures it demanded be
reused, a repair that deleted its own context, a display format copied as code,
and an invisible control byte. **The guardrails needed guarding more than the
model needed correcting** — and the way to tell the difference is cheap: when two
models of very different capability fail identically, the judge is the suspect.

## 7q — Splitting the plan, and the green test that was green for the wrong reason

`account_area_navigation` was split into three plans of one test each —
`favorites_navigation`, `profile_navigation`, `invoices_navigation` — as a
mechanical transform of the original JSON, costing no requests. The original is
kept with `supersededBy` in its meta.

The split worked as intended on the dimension it was meant to fix. Prompt 8.0k ->
7.2k, and where the combined plan produced 4-10 problems per attempt, each small
plan produced 0-2:

| Plan | Requests | Outcome |
|---|---|---|
| favorites | 1 + 0 | 2 problems, both one root cause; **applied from the saved reply after a tooling fix, no second request** |
| profile   | 1 | clean on the first attempt |
| invoices  | 2 (1 refused, 1 served) + 1 repair | clean after one repair |

### One cause, two reported problems

The favorites reply wrote `nav_favorites = page.locator(...)` without `self.`.
That line fell through `splitAddition` to the methods list, was appended after the
last `def` in the file, and so landed **inside the body of `expect_loaded()`** —
which then tripped the "existing method would change" gate as well. Normalising a
bare locator inside an ADD TO block (there is only one thing it can mean) fixed
both, and `--apply-last` then wrote the already-paid-for reply. The bare-locator
gate still fires for whole-file blocks, where the model chose that assignment
deliberately.

### The expensive kind of green

Then the full suite went red on two of the three. Cause: **two of three replies
silently dropped the plan's opening `goto("/account")`**, and one of them had
passed when run on its own — the login flow happens to land on /account, so the
missing navigation was invisible in isolation. It only failed once an earlier test
in the shared session had moved the page elsewhere.

That is the worst outcome available: not a failure, but a pass for the wrong
reason. It survived every gate, `py_compile`, and a single-file pytest run.

Now gated: every `goto` the plan names must appear in the produced files or in a
page object the test binds to — one hop from the test, which is everywhere that
could navigate. It flags exactly the two bad replies and leaves the good one
alone.

Both invalid tests were deleted rather than kept as known-red. A test that can
pass for the wrong reason is worse than no test; they will be regenerated against
the new gate. `AccountPage` keeps its three click methods, which the next run will
find in the index and reuse.

### Where the day ended

- saucedemo 18/19, practicesoftwaretesting 12/16, `test_profile_navigation.py`
  green from the split.
- 46 of 46 requests used. Three were wasted by my own `--apply-last` bug; one
  reply was recovered for free by a tooling fix.
- Gates added today: arity, literal type, invented Playwright API, column-0 defs,
  bare locators, missing navigation, and a control-byte scan of `src/` itself.
  Every one of them was written after watching the exact failure it now prevents.

### The through-line for the article

Six of the seven defects fixed today were in the harness, not the model: a gate
that contradicted its own contract, a count summed on the wrong axis, an index
that withheld the selectors and signatures it demanded be reused, a repair prompt
that deleted its own context, a display format the model copied as code, and an
invisible control byte. The model's genuine share was smaller and duller —
dropping a step, inventing a method name.

**The cheap tell:** when two models of very different capability fail in exactly
the same way, the judge is the suspect. **The expensive tell:** when a test passes
in isolation and fails in the suite, ask what it was relying on rather than what
broke.

## 7r — Both plans green, and the append-only contract finally paid out

2026-08-22, fresh budget. The two plans deleted yesterday for the missing-goto
defect were regenerated against the new gate. Both green, in the full suite.

**The prompt fix that mattered was one clause.** The first attempt navigated but
did it as `app.goto(...)` in the test body — breaking rule 11, which already said
"never `app.goto(...)`". The rule stated the prohibition without the alternative,
so the model knew what not to do and had nowhere to put the navigation. Rule 11
now ends: *a plan step with action "goto" becomes an `open()` method on the page
object for that screen, which the test calls first — dropping it gives a test that
only passes when the browser happens to already be on that page.* Next attempt:
clean, with a real `open()`.

A prohibition without an alternative is half a rule. Same shape as the index
withholding signatures — the model is told the answer is wrong and not what right
looks like.

**Verified in the suite, not in isolation.** Both were run as part of the whole
file set, deliberately, because a single-file pass is exactly what hid yesterday's
false green.

### The contract paid out, measurably

Three features in a row touched the same `AccountPage`:

| Feature | Blocks returned | Touched the shared page object? |
|---|---|---|
| favorites | 3 | yes — added `open()` and `click_nav_favorites` |
| profile | 3 | yes — added `click_nav_profile` |
| invoices | **2** | **no** — reused `open()` and `click_nav_invoices` |

The third feature was the cheapest of the three, because the shared file had
accumulated what it needed. "The prompt shrinks as a suite matures" was a claim in
the article; this is the first run where it was observed rather than argued.

### Totals

16 suites, 37 tests, **32 passing**, 5 red with known causes. 112 requests across
four days, 14 distinct free models, $0.00. Today's cost for two green features:
5 requests, two of which were refusals.

## 7s — All five red tests fixed: 37 of 37 green, and four of the five were not selector bugs

The five reds were assumed to be selector rot. Investigated, they were five
different problems, and only one was what the healer is built for.

| Red | Real cause | Fix | Requests |
|---|---|---|---|
| registration ×2 | **invalid fixture data** — the planner invented `+355691234567` ("Only numbers are allowed") and `StrongPass123` (a symbol is required). Two extra fields errored, so a correct assertion failed | verified valid values against the live form, fixed the plan, regenerated | 1 |
| catalogue_sorting ×2 (a) | strict-mode violation in an **inherited** page-object method the reply never touched | healer: `self.product_names` → `.first` | 2 |
| catalogue_sorting ×2 (b) | **wrong expected values** — the capture only ever saw the unsorted first page, so the planner guessed what sorting puts first and got both wrong | probed the live sorts, fixed the plan, regenerated | 1 |
| product_detail ×1 | the app **replaces** the add control with a remove control; the test asserted the same element changes text. The replacement selector was never captured, so the toggle was the only thing the plan could express | added `item_detail_added` as a capture page, fixed the plan, regenerated | 3 |

Total: 7 requests, 2 of which the healer wasted (see below), plus free plan and
descriptor edits. **37 tests, 37 passing, nothing red.**

### The assertions were right; the data was wrong

The registration tests were well designed — fill every field, blank only the one
under test, assert its error appears and no other does. They failed because two
*other* field values were rejected by validation unrelated to the test. The
capture can show which fields exist; only submitting can show what they accept.

Prevention, not just repair: `sampleData` on the site descriptor now carries
field values verified against the live application, and planner rule 4b tells the
model to use them for any field that is not the subject of the test.

### Prose in a descriptor does not constrain a planner

The `item_detail` capture note already said the control is "REPLACED by a remove
control once clicked". The planner still wrote a toggle assertion — because it is
told to copy selectors character-for-character from the observed list, and
`[data-test="remove"]` was not in it. **A fact stated in prose and absent from the
machine-readable list is a fact the planner cannot act on.** Fixed by capturing the
state, with readiness set to the remove control itself so the capture cannot
succeed in the wrong state.

### The gate that cost three rejections

`inventory-item-name` matches nine elements on the product list and exactly one on
a detail page. The multi-match set was the maximum across all captures, so
`.first` was demanded inside `item_detail_page.py`, where the page has one. Three
rejections and a repair round that drifted 3 → 5 problems. A page object is now
judged against its own page (`models/item_detail_page.py` → the `item_detail`
capture), and the reply from the *first* attempt then passed unchanged and was
applied for free.

Third time this session that re-judging a paid reply after fixing the tooling
turned a rejection into a pass. `--validate-only` and `--apply-last` have now
saved more requests than the repair loop has spent.

### Two efficiency findings

- **The healer does not re-check between patches.** Two failures shared one root
  cause; the first patch fixed both, and the healer spent a second request that
  came back "file unchanged". It should re-run the suite, or at least dedupe
  failures by the source line they blame, before asking again.
- **Gates judge what the model writes, not what it reuses.** The strict-mode
  violation lived in a page-object method no reply touched. A test can be perfect
  and still fail on an inherited defect; a lint pass over existing page objects
  would catch that class without a model.

### Totals

16 suites, 37 tests, **37 passing, 0 red**. 121 requests over four days, $0.00.
Known limitation left standing: the sorting tests name the first product, which
couples them to the demo dataset. Asserting that the rendered names are in sorted
order would be stronger and needs a plan action that does not exist yet.

## 7t — Splitting the checkout plans, and deleting six methods by hand-rolling a side effect

### Dedupe before splitting

The three remaining plans held ten test entries. Comparing step lists by hash: the
union is **five distinct tests**, and **three of the five were already in the suite
and green** — the plans had been written on different days and overlapped almost
completely. `checkout_cancel` was entirely contained in the other two.

Only the two cancel-checkout tests were new. They are now one plan each; the three
originals carry `supersededBy` and a note naming which of their tests already
existed where.

Prevention: the generator now reads the suite's test function names before
sending anything, warns on every duplicate, and **refuses to spend a request on a
plan whose tests all already exist**. Paying a model to regenerate a passing test
is waste that reports itself as progress.

### Relevance from the plan, not from selector overlap

A one-test plan still produced a 12.0k prompt because five page objects were
expanded in full — including the product detail page, relevant only because it
shared one selector. The plan already declares which pages each test uses, so that
is the signal now. 12.0k → 10.5k, and the expansion is limited to pages the test
visits.

### Four more normalisations instead of four more requests

- **`ADD TO: cart_page.py`** without the directory → `models/` restored. Three
  errors saying "no such page object" for three files that all exist.
- **The repair prompt now lists the blocks the reply must contain.** "Re-send every
  file you sent before" was not enough three times over; one repair came back with
  a page object and no test file at all.
- **A whole file for an existing page object is rewritten as an addition** of only
  what is new, rather than rejected. Cheaper than another request, and *safer* than
  the file: an addition can only insert, so a member the reply forgot cannot be
  deleted. Members that already exist are dropped whether or not their bodies
  match — re-deriving `open()` is what writing a whole file means, not a request to
  change it.
- **Page-object methods return None.** `checkout = cart.click_checkout()` reads
  naturally and yields None, and the next line dies with AttributeError. Rule 12b
  says so, and a gate now rejects assigning from a `-> None` method. Fourth failure
  this session caused by showing a model half an interface — a return type is part
  of a signature.

### Two inconsistencies that were mine, not the model's

- **`expect_url` existed with two different signatures** across four page objects:
  one took a path, three hard-coded their own. Two repair rounds went on exactly
  that, and no model could have known which was which from a list of names. The
  three now take an optional path defaulting to what they hard-coded, so both call
  styles work and no existing caller breaks.
- **The few-shot example leaked into the answers.** It was `sign_in_page.py`, a
  realistic name — and two different models imported `.models.sign_in_page` into a
  suite that has no such file. It passed every gate and `py_compile`, then pytest
  could not collect the file. Renamed to `example_page.py`, plus a line saying the
  example's names belong to no suite, plus a gate: every page object a test imports
  must exist. Same shape as the `name = selector` notation being copied as code —
  **a format sample that reads like real code gets used as real code.**

### And then I deleted six methods

`test_successful_checkout_flow` went red with
`'CheckoutStepTwoPage' object has no attribute 'expect_summary_visible'`.

The whole-file→addition conversion was implemented as a **side effect inside
validateFiles**: it mutated the block it was handed. That works on the generate
path, where the same array is later written. `--apply-last` re-parses the reply
from disk, so the mutation never happened, the whole file was written as a whole
file, and every member the reply had omitted was deleted — the exact catastrophe
the append-only contract exists to prevent, caused by the code that implements it.

Fixed by extracting `normalizeBlocks(files, existing)` as an explicit step that
every caller runs before validating or writing, with validateFiles keeping a guard
that errors loudly if a caller skips it. **A transformation that both validation
and writing depend on cannot live inside either one.**

The page object was restored by hand from the captured selectors. Restoring it
"more sensibly" broke the test a second time: `expect_url()` defaulted to
`/checkout-complete.html`, the page reached after Finish rather than this screen's
own URL. Odd, and load-bearing.

The gate suite caught the design change both times I altered this contract — once
when conversion made a rejection obsolete, once when the guard made the self-test's
own call path wrong. That is the suite doing its job on the code that judges the
model.

### Totals

18 suites, **39 tests, 39 passing, 0 red**. 135 requests over four days, $0.00.
Today: 26 requests for two new tests, five red tests fixed, and eleven changes to
the harness. Nine of today's requests were spent on defects that turned out to be
mine.

## 7u — Opening the shopping funnel, and a verification error of my own

Coverage analysis first, which cost nothing and changed the plan: every plan was
built, but comparing captured pages against tests showed the whole shopping funnel
of practicesoftwaretesting was **uncaptured and untested** — no product page, no
cart, no checkout — on a site whose entire purpose is shopping. Also uncovered:
categories, the language switcher, `messages` (captured, zero tests), and on
saucedemo logout, the burger menu, and the deliberately-broken accounts.

### Seven new captures, no model requests

`product_detail`, `product_detail_added`, `cart`, `checkout_signed_in`,
`checkout_address`, `checkout_payment`. Probing first, then authoring:

- The checkout is a **four-step wizard that renders every step's fields at once**
  and hides the ones not yet reached. `country`, `payment-method` and `finish` are
  all present on step 1 and invisible. **Visibility, not presence, tells the steps
  apart** — and `proceed-2` does not exist until step 2 renders, which makes it a
  readiness marker the previous step cannot satisfy.
- Product pages are addressed by ULID, which this site declares unstable, so the
  capture reaches them by clicking rather than by path.

### This site does not behave like the other one

The first plan asserted that add-to-cart disappears after adding. That is SauceDemo.
Here the button stays, reading "Add to cart", and what changes is `cart-quantity`
appearing in the header plus a toast. Neither exists before the click, so a plan
written from `product_detail` alone had nothing true left to say about it —
`product_detail_added` fixes that.

### resetState was null

There was no reset at all for this site, so every test inherited whatever the
previous one left in the cart. Latent for the whole suite; it surfaced only when a
test asserted an absolute count and got 2. The cart lives in **sessionStorage**
(`cart_quantity`, `cart_id`) — verified, not assumed — so a `removeStorage` action
was added to both action runners that removes **named keys only**. A blanket clear
would take the auth token with it and log the run out.

### Four more gates, each after watching the failure

- **An unstable path is as perishable as an unstable selector.** A plan opened
  `goto("/product/01M0MRXRTD5V08KC3NTDBNFSDG")`. The site's unstable patterns were
  applied to selectors and not to paths; now both. The planner also no longer
  advertises the URL of a page the descriptor gives no stable path — that URL is an
  artifact of the capture route, not an address.
- **`from playwright.sync import Page`** — one character from correct. py_compile
  accepts it, and pytest then cannot collect the file, taking the other eighteen
  tests down with it, because a collection error stops the run.
- **A saved reply is only an answer to the plan it came from.** I corrected a
  plan's expected cart count from 1 to 2, then `--apply-last` applied a reply
  generated before the correction. It passed every gate — the gates check that a
  test is well-formed, not that its literals match the plan. Replies older than the
  plan file are now discarded.

### And a verification error that was mine

I reported both suites green on the strength of a single "21 passed" line from a
command that ran both. It was saucedemo's; practicesoftwaretesting was broken by
the bad import at the time. **A check that cannot distinguish the two things it is
checking is not a check** — the same defect I have been finding in generated tests
all day, in my own shell command. Both suites are now verified separately, and the
count I had reported as 42 is 41.

### Totals

19 suites, **41 tests, 41 passing**. 148 requests over four days, $0.00.
Queued: two one-test cart plans (`add_product_to_cart`,
`cart_total_calculates_correctly`), then the checkout wizard, categories, the
language switcher, `messages`, and saucedemo's logout and problem accounts.
