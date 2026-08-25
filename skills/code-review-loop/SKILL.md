---
name: code-review-loop
version: 1.0.0
description: Write the application changes a migration implies, open a pull request, get it reviewed by an independent reviewer, and address the findings before asking anyone to approve anything. Load whenever a change has a non-empty blast radius.
---

# The code review loop

A schema migration is half a change.

Dropping `users.plan_name` is not finished when the column is gone. It is finished when the
fourteen places that read it no longer do. AIRLOCK already computed those fourteen places —
that is what the blast radius is — so leaving them as a to-do list for a human afterwards is
leaving the job half done and calling it proven.

So: write the code, open a pull request, get it reviewed by something that is not you, fix
what it finds, and only then ask for approval.

---

## Why the review is somebody else's job

You are the worst available reviewer of your own diff, for the same reason the requester is
the worst available approver of their own change. Not because you are careless — because you
already believe the thing is right, and a reviewer's entire value is not sharing that belief.

A second prompt to the same model is not an independent reviewer. It is you, warmed up.

The reviewer's findings on **your** code are treated the same way AIRLOCK treats every other
claim: a positive finding is believed on sight, and a claim that it went away is recomputed.
A finding counts as addressed only when a commit landed *after* it was raised.

---

## The loop

### 1. Read the blast radius

`airlock_get_change` gives you `blast_radius` — repository, file, line, enclosing symbol, for
every reference the scout found. That is your work list. If it is empty there is nothing to
do here and the gate does not ask for a review.

### 2. Write the changes, expand/contract shaped

Load the `expand-contract` skill. The application changes follow the same three phases as the
migration, and the important property is the same: **every intermediate state is deployable.**

The code must be correct against the database *before* the migration and *after* it, because
there is a window — possibly a long one — where both are true somewhere. Code that only works
after the column is gone is code that breaks the moment you deploy it and the migration has
not run yet.

### 3. Open the pull request

Use the `github` tools: `create_branch`, then `create_or_update_file` or `push_files`, then
`create_pull_request`.

Write the PR body for the reviewer, not for a changelog. State which migration it accompanies,
which AIRLOCK dossier it belongs to, and — most usefully — what you were unsure about. A
reviewer told where to look is worth three that were not.

**You cannot merge it.** `merge_pull_request` is not in your tool set and its absence is
asserted in CI. That is deliberate and it is the same rule as everywhere else here: you
propose, a human applies. Do not ask to have it merged, and do not treat an unmerged PR as a
problem to route around.

Then `airlock_attach_code_changes` with the repo, branch, PR number and file count.

### 4. Get it reviewed

The reviewer runs on the pull request. Read what it said back with the `github` read tools —
`get_pull_request_comments`, `get_pull_request_reviews`.

Report **everything it found**, including findings you disagree with, through
`airlock_attach_code_review`. You are not the filter. AIRLOCK decides which severities block,
and a reviewer whose findings get pre-screened by the author is a reviewer nobody needs.

Report each finding's `raised_at` accurately. That timestamp is what a fix is checked against.

### 5. Fix, push, re-report

For each blocking finding: fix it, push, and call `airlock_attach_code_review` again with
`addressed_by` and `addressed_at` set to the commit that did it.

If you genuinely believe a finding is wrong, say so plainly in the PR thread and leave it
open. Do not fabricate a commit reference. A human can waive it with a written reason, and
that is the correct route — an override made by a person who is accountable for it, not one
made quietly by you.

### 6. Then, and only then, ask

`airlock_check_gate`. If the review is clean or addressed and everything else holds, the gate
opens and `airlock_request_approval` puts it in front of a human.

The line they will read is:

> Code changes prepared · reviewed by Qodo · 3 findings addressed

That sentence is the whole point of this skill. It says the agent wrote code, something else
reviewed it, and the findings were dealt with — before a person was asked for anything.

---

## What blocks and what does not

| Severity | Blocks the gate |
| --- | --- |
| `blocker` | yes |
| `major` | yes |
| `minor` | no |
| `nit` | no |

Nits do not block, deliberately. A system that refuses to ship a migration over a naming
preference is a system whose reviews get skipped, and a skipped review is worth less than no
review at all because it looks like one happened.

---

## The failure you are most likely to cause

Writing code that is correct only after the migration.

The reviewer will usually catch it, and if it does the finding will be phrased as a null
dereference or a missing field rather than as "you forgot expand/contract". Read it that way:
a blocking finding on a field access is very often this mistake wearing a different hat.
