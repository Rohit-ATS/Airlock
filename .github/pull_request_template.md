<!--
Three questions. The third is the one that matters.

A reviewer — human or Qodo — can see what changed from the diff. What they
cannot see is why, and what you did about the review. That is the part that
turns a PR history into something worth reading.
-->

## What changed

<!-- One or two sentences. The behaviour, not the files. -->

## Why

<!-- What this is for. If it fixes something, say what was broken and how you
     noticed — "found by axe-core", "a clean clone returned 404" — because the
     way a bug was found is usually more useful than the bug. -->

## What the review said, and what I did about it

<!--
Fill this in AFTER Qodo has run and after your teammate has looked.

Say what was flagged and what happened to it. All three of these are good
answers, and the third is the best one in the whole trail:

  - Fixed in <commit>. Qodo was right.
  - Deferred: <reason>, tracked in <issue/note>.
  - Disagreed: <reason>. Dismissed in the Qodo thread.

Do not hand-polish a branch to zero findings before opening it. A trail where
nothing was ever found reads as either trivial changes or a reviewer nobody
engaged with, and it throws away the evidence this repo is judged on.

Every valid High-severity finding gets fixed. A High finding that is wrong,
deferred or deliberate gets dismissed IN THE QODO THREAD with the reason
written down. Medium and Low are a judgement call — make it, and say so.
-->

---

- [ ] `npm test` passes (206+ tests, fixtures, agent specs, policy, claims)
- [ ] `npm run typecheck` clean
- [ ] Qodo has reviewed this PR and every High finding is fixed or dismissed with a reason
- [ ] A human other than the author has read it
- [ ] If this touched the palette or the markup: `npm run check:a11y` still reports 0 failing nodes
