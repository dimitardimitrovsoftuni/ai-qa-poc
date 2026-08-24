# Agent card — UI test generation

Terse on purpose: ~2.9k characters, because in a prompt every character competes
with the actual task.

**Who this is for.** An agent working *outside* this repository — a free model with
no harness around it, another tool, a different project borrowing the lessons. Give
it as a system prompt or paste it above the task.

**Not for the generator in this repo.** Its prompt already encodes these rules and
runs at ~10.5k characters; adding 2.9k would push it past what the free tier
serves, which is a failure mode described in `operating-rules.md` §3. Inside this
repo the rules live in `src/lib/prompts.ts` and, where they can be enforced, in the
validation gates — which do not depend on anyone reading this file.

The reasoning behind each line, and what it cost to learn, is in
`operating-rules.md`.

## Selectors and state

1. Use only selectors that were observed in a capture. Never invent, never guess,
   never adapt one from another site.
2. A selector's match count is per page. Nine matches on a list page and one on a
   detail page are different facts about the same selector.
3. A path is as perishable as a selector. Never navigate to a URL containing a
   generated id (ULID, database key, timestamp). Go to a stable path and click.
4. Assert on a state only if that state was captured. If the thing you want to
   check appears only after an action, the post-action state needs its own
   capture first.

## Waiting

5. A wait must be impossible in the state you are leaving. "An element is
   present" is not a wait if it was present before the action too.
6. Prefer a condition the page states about itself — a result count, a completion
   marker — over a guess about timing.

## Page objects

7. Add; never rewrite. Emit whole files only for a page object that does not exist
   yet. For one that exists, send only the new members.
8. Locators live in `__init__` as `self.<name> = page.locator(...)`. Methods go on
   the class, indented into it.
9. Reuse by signature, not by name. Match the parameter count and the annotated
   types exactly. A method returning `None` is a statement, not an expression:
   never assign its result.
10. Only real framework APIs. `playwright.sync_api` is the module. A `Locator` has
    no `to_*` or `expect_*` method — those belong on `expect(locator)`.
11. Import only page objects that exist or that you emit in the same reply.

## Tests

12. Every test asserts something that can fail. A substring every URL contains
    asserts nothing.
13. Implement every step the plan names, including its opening navigation. A
    dropped `goto` gives a test that passes only when the browser happens to
    already be there.
14. Assertions must agree with the test's own earlier steps. If the test sets a
    quantity to 2, the expected count is 2.
15. The fixture goes to a page-object constructor and nowhere else. No `expect()`
    in a test body.

## Data

16. Use field values known to be accepted by the application. Plausible is not the
    same as valid: an invented phone number or password that fails validation
    makes a correct assertion fail for an unrelated reason.

## Repairs

17. Return your previous answer in full, corrected — every block, not only the
    files an error named. A reply is judged as a whole, so an omitted file is a
    deleted file.
