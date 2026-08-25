# Contributing

[ARCHITECTURE.md](ARCHITECTURE.md) explains how the pieces fit. This is how to change one.

## Run it

Node 22.14 or newer.

```bash
npm install
npm run build --workspace @airlock/contract   # apps/console imports the build output
npm run dev --workspace @airlock/console      # PORT=3100 if 3000 is taken
```

`/console` takes a minute or two to compile the first time in dev — it pulls in 16,697 modules
from the harness SDK. It is not hung.

## Check it

```bash
npm test            # 14 suites + fixtures + agent specs + policy + the README's claims
npm run typecheck   # every workspace
npm run gen         # regenerate schema, docs, fixtures, claims table — must be a no-op
```

`npm run gen` producing a diff means the docs and the code have drifted, and CI fails on it.
Commit the regenerated files.

Accessibility is not in `npm test`, because it needs a browser binary and a check that is flaky
for environmental reasons trains people to ignore it. Run it by hand after touching the palette
or the markup:

```bash
npx playwright-core install chromium   # once; npm install does not fetch the binary
npm run check:a11y                     # expects: TOTAL failing nodes: 0
```

## Open a pull request

**Every substantive change goes through a pull request. Direct pushes to `main` do not count as
reviewed work** — that is a hackathon rule, and it is also just how this repo is run.

```bash
git switch -c fix/the-thing        # or feat/, docs/, chore/
# …work…
npm test && npm run typecheck
git push -u origin fix/the-thing
gh pr create --fill
```

Qodo starts on its own. If it does not, comment `/agentic_review` on the PR.

### What good looks like here

**One concern per PR, 200–400 lines.** Six enormous pull requests means nothing was really
reviewed. Small ones mean every change genuinely got looked at, and that is visible from the
list of titles before anyone opens one.

**Do not hand-polish a branch to zero findings before opening it.** A trail where the reviewer
never found anything reads as either trivial changes or a reviewer nobody engaged with. Open
honest work, let it get reviewed, fix what is real. The trail is the artifact.

**Every valid High-severity finding gets fixed.** A High finding that is wrong, deferred, or
deliberate gets **dismissed in the Qodo thread with the reason written down** — not merged over
silently. Medium and Low are your engineering call; make it, and say which way you went.

**Disagreeing, in writing, is the most valuable thing in the trail.** It is the only entry that
proves a human was thinking rather than complying. Do not manufacture disagreements. Do write
them properly when they happen.

**Two reviewers: one human, one machine.** Qodo reviews every PR, and so does the other person
on the team. Both, on every change.

**Then a human merges.** Not the bot, and not the author without a second pair of eyes.

## House style

The code in this repository explains *why*, not *what*. A comment that restates the line above
it is noise; a comment that records the failure which caused the line to exist is the most
valuable thing in the file. Several of the longest comments here are transcripts of real bugs —
a stylesheet that silently broke every responsive variant, a scorer that rewarded a model for
writing SQL that would not parse. Match that density.

Two conventions worth knowing before your first PR:

- **Schemas live in `dossier.ts`; logic lives in its own module.** Doing it the other way round
  creates an import cycle immediately. See `quarantine.ts`, `review.ts`, `resolve.ts`.
- **Rules live in `packages/contract`, never in a component.** If you are writing a conditional
  in the console that decides whether something is *allowed*, it is in the wrong file.

## If you are adding a claim to the README

Add it to `scripts/verify-claims.mjs` with a file and an anchor — an exact fragment of the code
that implements it — then run `npm run gen:claims`. The table regenerates with real line
numbers, and `npm test` fails if an anchor ever stops resolving.

Claims that cannot be anchored do not belong in the README. That rule exists because a reader
who cannot check one claim quietly discounts the rest.
