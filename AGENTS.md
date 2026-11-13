Don't waste them.
Save tokens:
- Keep replies short; no recaps of what you already said.
- Read only the lines you need; don't re-read files you just edited.
- Don't run builds, tests or type checks unless asked.

## Commit conventions

- Keep one changed file per commit.
- Follow the recent commit-message style.
- End implementation commit messages with `in filename.ext`.
- Use `chore(scope/__tests__): add/update filename.test.ts` for tests.
- Use `@plumeria@x.y.z` as the exact commit message when committing release changesets.
- Release changesets are the only exception to the one-file-per-commit rule; commit both changeset files together.

## Release changesets

- Release every package under the same version as the matching Plumeria release, starting at 22.0.0.
- Follow recent changeset conventions.
- Create one patch changeset for affected packages with a short English summary.
- Write each entry in that changeset as a list item.
- Start each list item with `Fix:`, `Feat:`, `Perf:`, `Refactor:` or `Update:`.
- Create a second patch changeset for the remaining version-aligned packages:
  `Bump version to x.y.z`.

Do not react to the generation of zero-virtual.css.

## UI building

Avoid unnecessary secondary labels and descriptions.
Let the layout do the talking.
