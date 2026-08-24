# Operating rules

What four days of building this taught us, written for whoever picks the work up
next — a person, a capable agent, or a free one.

Read this before changing the harness. Read `agent-card.md` instead if you are
generating tests: it is the same knowledge, compressed to fit inside a prompt.

There are three places knowledge can live here, and they are not equally strong:

| Where | Strength | Who it binds |
|---|---|---|
| a validation gate | **strongest** — enforced, cannot be ignored | every model, free or paid |
| this document | weak — advisory, competes for context | whoever reads it |
| a note in a descriptor | weakest — prose | nobody |

That ranking is itself the hardest lesson of the build. **Prefer converting a rule
into a gate over writing it down.** `npm run gates` is 25 cases and it is where the
durable knowledge actually lives; this file exists for the judgment that cannot be
mechanised.

---

## 1. On checks

**A control that cannot fire produces the same output as a control that passes.**
Four gates were silently dead for a day — two neutered by an edit that wrote a
literal backspace byte where `\b` was intended, two never applied by patches that
reported success. Every run said "generated on the first attempt".

- Gates get their own test suite: something each must reject, something each must
  accept. A gate whose test does not exist is a gate you are guessing about.
- Never patch source with shell string replacement. It writes invisible control
  bytes and no editor, diff or `sed` output shows them. `npm run gates` now scans
  `src/` for 0x08/0x0b/0x0c because this happened twice.
- When you change what a gate does, expect its self-test to fail. That is the suite
  working. Update the expectation deliberately and state the new invariant.

**A check that cannot distinguish the things it checks is not a check.** Two suites
were reported green on the strength of one `21 passed` line from a command that ran
both. Verify each separately.

## 2. On judging a model's output

**When two models of very different capability fail identically, the judge is the
suspect.** A 9B and a 550B were both told to chain `.first` onto a selector that
matches one element per page, because the detector had summed matches across pages.
Models three orders of magnitude apart do not make the same mistake. This check is
free and it should run before any diagnosis of the model.

**Re-judge what you already paid for.** When a gate turns out to be wrong, the
replies it rejected may now pass. `--validate-only` re-scores every saved reply
against current gates; `--apply-last` writes one that passes. Three rejections
became passes this way, at no cost. But: **a saved reply is only an answer to the
plan it came from** — replies older than the plan file are discarded, because the
gates check that a test is well-formed, not that its literals match the plan.

**Distinguish "was it served" from "was it good".** A single `--once` request
answers the first question for the price of one request; a retry loop converts a
precise refusal into a vague timeout.

## 3. On what you give a model

**Half an interface is the half that fails.** Three failures in a row came from
withholding part of an interface: a locator name without its selector, a method
name without its signature, a signature with the type annotations stripped. Show
selectors, parameters, and their types — for the files the work touches.

**Detail must be paid for.** Spelling everything out for every file pushed the
prompt over what the free tier serves and the request was refused outright. Files a
feature does not touch get one line. Relevance comes from the plan's declared
pages, not from selector overlap.

**Reference material that looks like code gets used as code.** An index that listed
locators as `name = selector` produced `nav_favorites = [data-test="..."]` in a
Python file. A few-shot example named `sign_in_page.py` was imported by two
different models into a suite with no such file. Make examples unmistakably
illustrative and use notation the target language cannot parse.

**A prohibition without an alternative is half a rule.** "Never `app.goto(...)`"
was already in the rules; the model navigated in the test body anyway, because
nothing said where a navigation belongs. Adding "a goto step becomes an `open()`
method on that page object" fixed it in one line.

**Prose in a descriptor does not constrain a planner.** One page's note said the
application *replaces* a button rather than relabelling it. The plan asserted a
relabel, because the planner may only use selectors from the observed list and the
replacement selector was not in it. If a fact must shape output, it has to be in
the machine-readable part.

## 4. On the contract

**Append-only.** The generator may create a file that does not exist or add members
to one that does. It may never rewrite, because rewriting deletes whatever the
reply forgot — that is how a cart feature deleted the login suite's methods and
turned five green tests red.

**Normalise, do not reject, when the intent is unambiguous.** A flush-left method,
a locator missing `self.`, a path missing its `models/` prefix, a re-sent member
with an identical body, a whole file for a page object that exists — all of these
have exactly one possible meaning, and converting them is cheaper than a request
and safer than the alternative. Reject only genuine ambiguity.

**But normalisation is a step, not a side effect.** Implemented inside the
validator, it mutated the block it was handed: correct on the generate path, absent
on the apply path, and it deleted six methods from a page object. A transformation
that both validation and writing depend on cannot live inside either one.

**A repair carries the whole previous answer.** Sending only the files an error
named turned one problem into four, twice. A model returns what it was shown, and a
reply is judged as a whole. Name the required blocks explicitly as a checklist.

## 5. On plans

**One test per plan generates cleanly. Three or more thrash.** Every first-attempt
success in four days came from a one- or two-test plan. Splitting is a free,
mechanical transform of the JSON.

**Dedupe before generating.** Three checkout plans held ten test entries: five
distinct tests, three of which already existed and were green. Paying a model to
regenerate a passing test is waste that reports itself as progress. The generator
now refuses a plan whose tests all exist.

**The capture sets a ceiling — on assertions, on expected values, and on data.**
Tests that could not fail, because the error state was never captured. Sorting
tests that named the wrong first product, because only the unsorted page was seen.
Registration tests with correct assertions and invalid fixture data. Known-good
field values belong in the site descriptor, verified by submitting the form.

**Probe the live application for ground truth.** Not the model's claim, not your
memory, not a note written last week. Every diagnosis in this build that turned out
to be right started with a probe, and several that started with a recollection were
wrong.

## 6. On the free tier

- **Size shifts the odds; it does not draw a line.** 4.5k was refused ten seconds
  after 10.4k was served; 10.4k was refused twenty minutes after the same prompt
  and model succeeded twice. Availability moves minute to minute.
- **The router is a lottery over capability, not only uptime.** Fourteen models
  answered this project, 9B to 550B. Small models produce incoherence (calling
  methods their own reply never defined); large ones produce format disobedience.
  The second is closer to usable. Record which model answered, and pin one when the
  question is about capability.
- **Retry a refusal once or twice before concluding anything.** Roughly a third of
  refusals cleared on an immediate retry.
- **Count failures in the ledger.** An early version recorded only successes, and
  three days of budgeting were done on flattering numbers.

## 7. On verifying tests

**A test that passes alone and fails in the suite was relying on something.** A
missing `goto` passed in isolation because the login flow happens to end on the
right page. Run the full suite; a single-file run proves less than it appears to.

**A green test is not evidence until you know why it is green.** Delete a test that
can pass for the wrong reason rather than keeping it as known-red.

**Shared session state leaks.** `resetState` was null for a whole site, so every
test inherited the previous one's cart. Reset named storage keys, never all of them
— the auth token usually lives there too.

## 8. Where things are

| Path | What |
|---|---|
| `npm run gates` | 25 self-tests over the validation gates. Run before and after touching them. |
| `docs/agent-card.md` | the compressed rules, for pasting into a generating prompt |
| `docs/build-log.md` | the evidence: every failure in the order it happened, with numbers |
| `config/sites/*.json` | per-site descriptor: pages, captures, reset, known-good data |
| `src/generator/run_generator.ts` | the contract, the merge, and most of the gates |
