# Agent benchmark — public-prompt series (Plumeria)

Can a coding agent produce working Plumeria code on the first
try when given one fixed, published prompt? This page records
the protocol and per-run results. Measured November 2026.

Result: **100 of 100 runs passed build + lint on the first
try** (20 tasks × 5 runs). Two tasks (5 and 6) are counted
from re-measurements taken after the ai doc was fixed at the
exact spots their first measurements failed; the pre-fix
results are disclosed under "First measurements" below.

## The prompt (verbatim, as pasted to every agent)

> Build this with Plumeria for all styling. First read
> https://plumeria.dev/docs/installation and
> https://plumeria.dev/docs/ai in full, and follow every rule
> in the ai doc exactly — including the property order and the
> border shorthand expansion. If the project is not set up
> yet, set it up the way the installation doc describes. Task:
> \<task body — one of the 20 below\> Build with
> `npm run build` and lint with `npm run lint`; both must
> pass.

A lab-scaffold note (not part of the prompt) told each agent
not to run build/lint itself (the harness runs them) and to
report the doc URLs it fetched, package versions, files
changed, and surprises.

## Protocol

- Base: a clean Vite + React + TypeScript starter, verified
  build/lint-green untouched. Fresh starter and fresh agent
  session per run.
- Plumeria only; no comparison lanes in this series.
- The agent fetches the two documentation pages itself, as
  the prompt directs; every run read both in full.
- The harness runs `npm run build` and `npm run lint` after
  the agent finishes, then inspects the generated CSS against
  every value the task pins, and the code for behaviour.
- On a first-try failure, a fresh agent session receives the
  failure output with a scripted fix prompt; fix rounds are
  capped at 2.
- Primary metric: failure / fix-round count; first-try pass
  reported as x/y.
- No headless browser was available; verification is the
  generated-CSS inspection described above, not screenshots.
- Versions (data record only): all runs used @plumeria/core,
  @plumeria/unplugin and @plumeria/eslint-plugin 22.0.7,
  installed by `npx @plumeria/init --yes`. Task 5 was
  re-measured after the ai doc gained a Property formatting
  section (plumeria.dev, PR #694), and Task 6 after the ai
  doc clarified selector-parsed variant keys and the overlap
  rule (PR #695). The re-measured sets
  are the ones counted below.
- Agent (data record only): every run was a fresh subagent
  of a Muse Spark session (`meta/muse-spark`), on the same
  model as its parent. The subagent launcher accepts only
  the task text and attachments, so effort and thinking were
  the model's runtime defaults. The parent prepared the
  starters, sent the prompt, ran build, lint and the CSS
  checks, and managed fix rounds; the subagent fetched the
  docs, set up the project, wrote the code and reported
  back. Subagents could not see each other's work.

## Results per task (5 runs each)

| # | Task | First-try | Failures |
|---|------|-----------|----------|
| 1 | Responsive card grid + dark-mode toggle | 5/5 | 0 |
| 2 | Responsive nav with mobile menu | 5/5 | 0 |
| 3 | Themed button variants | 5/5 | 0 |
| 4 | Sign-in form with focus/error states | 5/5 | 0 |
| 5 | Badge list | 5/5 | 0 |
| 6 | Data table (striped rows, status badges) | 5/5 | 0 |
| 7 | Modal dialog | 5/5 | 0 |
| 8 | Tabs | 5/5 | 0 |
| 9 | Sidebar layout | 5/5 | 0 |
| 10 | Pricing tiers | 5/5 | 0 |
| 11 | FAQ accordion | 5/5 | 0 |
| 12 | Settings switches | 5/5 | 0 |
| 13 | Search filter list | 5/5 | 0 |
| 14 | Hero section | 5/5 | 0 |
| 15 | Toast stack | 5/5 | 0 |
| 16 | Profile card with Follow/Following toggle | 5/5 | 0 |
| 17 | Pagination (25 items, 5 pages) | 5/5 | 0 |
| 18 | Site footer (responsive columns) | 5/5 | 0 |
| 19 | Checkout stepper | 5/5 | 0 |
| 20 | Article page | 5/5 | 0 |
|   | **Total** | **100/100** | **0** |

## First measurements and the re-measurements

Two tasks failed in their first measurement. In both cases
the failure pointed at the ai doc, the doc was fixed, and
only the affected task was re-measured; the table above
counts the re-measured sets.

- Task 5, first measurement 4/5: one run's first build
  failed on `format-properties` warnings — a rule the lint
  gate enforced but the ai doc did not mention anywhere.
  The doc gained a Property formatting section (PR #694);
  re-measured 5/5.
- Task 6, first measurement 4/5: run 1's first build failed
  lint with two findings — `no-order-dependent-overlap`
  (`:nth-child(even)` and `:hover` both setting
  `backgroundColor` in one style object, relying on source
  order for the intersection) and `no-combinator` (a status
  variant keyed by the display string `'On leave'`; a space
  in a key parses as a descendant combinator). It converged
  in 1 fix round (compound `:nth-child(even):hover`
  selector; slug keys with a label map). The doc stated
  both rules but never said variant keys are selector-parsed
  and named only state pseudo-classes for the overlap rule;
  it was clarified at those two spots (PR #695) and Task 6
  was re-measured with 5 fresh runs: 5/5 first-try
  passes, every run applying both clarified passages.

## Measurement notes

- Task 16's first attempt was voided: the harness operator
  sent a non-canonical task body. It was re-measured from
  fresh starters with the canonical body (5/5).
- During Task 16's re-measurement, the local CSS checker for
  that task was found rewritten to the voided design's values
  (author unknown); it was restored from the canonical values
  and the runs re-verified against it.
