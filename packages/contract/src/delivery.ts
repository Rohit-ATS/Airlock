import type { Dossier } from './dossier.js';

/**
 * The certificate, rendered for the place the human already is.
 *
 * Pure on purpose. Deciding *whether* to deliver and deciding *what* it says
 * are the parts worth testing, and they should not need a GitHub token or a
 * network to be tested. The posting itself is twenty lines in the console app.
 *
 * The constraint that shapes the body: approval is the one human moment, so it
 * has to be answerable here, in seconds, without opening anything else. Verdict,
 * the evidence behind it, blast radius, exclusions, cost, and — the part usually
 * left out — what happens if they say no.
 */

/** The console origin, passed in rather than read from env, so this stays pure. */
export interface RenderOptions {
  consoleUrl: string;
}

function heading(dossier: Dossier): string {
  const certificate = dossier.certificate;
  if (!certificate) return 'AIRLOCK — no certificate';

  if (certificate.status === 'PROVEN') {
    return `AIRLOCK — ${certificate.kind} certificate proven`;
  }
  if (certificate.status === 'FAILED') {
    return `AIRLOCK — ${certificate.kind} certificate FAILED — the gate is sealed`;
  }
  return `AIRLOCK — ${certificate.kind} certificate ${certificate.status}`;
}

/**
 * The comment body.
 *
 * The constraint that shapes this: the approval is the one human moment, so it
 * has to be answerable here, in seconds, without opening anything. That means
 * the verdict, the evidence behind it, what is destroyed, what it cost, and —
 * the part usually left out — what happens if they say no.
 */
export function renderCertificateComment(dossier: Dossier, options: RenderOptions): string {
  const certificate = dossier.certificate;
  const link = `${options.consoleUrl.replace(/\/$/, '')}/console`;

  const out: string[] = [];
  out.push(`### ${heading(dossier)}`);
  out.push('');
  out.push(`No human started this run. It was opened by \`${dossier.started_by}\` when this pull request changed`);
  out.push(`${dossier.origin?.paths.length ?? 0} file(s) under \`migrations/\`, and certified without anyone typing a request.`);
  out.push('');

  out.push('| | |');
  out.push('| --- | --- |');
  out.push(`| Change | \`${dossier.dossier_id}\` (${dossier.change_class}) |`);
  out.push(`| Verdict | **${certificate ? `${certificate.kind} · ${certificate.status}` : 'no certificate'}** |`);
  if (dossier.origin?.head_sha) out.push(`| Proved against | \`${dossier.origin.head_sha}\` |`);
  if (certificate?.lock_ms_estimate !== undefined) {
    out.push(`| Estimated lock | ${certificate.lock_ms_estimate} ms |`);
  }
  if (certificate?.table_rewrite !== undefined) {
    out.push(`| Table rewrite | ${certificate.table_rewrite ? 'yes' : 'no'} |`);
  }
  out.push(`| Cost so far | $${dossier.cost.usd.toFixed(4)} |`);
  out.push('');

  if (certificate?.checksums) {
    const { pre, post, post_rollback } = certificate.checksums;
    out.push('**The proof.** The rollback was executed against a shadow copy and the data compared byte for byte.');
    out.push('');
    out.push('| Stage | Checksum |');
    out.push('| --- | --- |');
    out.push(`| before | \`${pre}\` |`);
    out.push(`| after forward | \`${post}\` |`);
    out.push(`| after rollback | \`${post_rollback}\` |`);
    out.push('');
    // Recomputed here rather than read from `checksums.match`, for the same
    // reason the gate recomputes it: a verifier's own opinion of whether it
    // passed is not evidence, and this comment is the evidence a human acts on.
    out.push(
      pre === post_rollback
        ? '`before == after rollback` — the inverse restores it exactly.'
        : '`before != after rollback` — **the inverse does not restore it.** The gate is sealed.',
    );
    out.push('');
  }

  if (certificate?.scope) {
    const { records, exclusions } = certificate.scope;
    const touched = records.reduce((sum, record) => sum + record.count, 0);
    out.push(`**Blast radius.** ${touched} record(s) across ${records.length} target(s).`);
    out.push('');
    if (records.length > 0) {
      out.push('| System | Table | Action | Count |');
      out.push('| --- | --- | --- | --- |');
      for (const record of records) {
        out.push(`| ${record.system} | ${record.table ?? '—'} | ${record.action} | ${record.count} |`);
      }
      out.push('');
    }
    /*
     * Exclusions are printed even when there are none, and that is deliberate.
     * "Nothing was excluded" and "exclusions were never considered" look
     * identical when the section is simply absent, and they are very different
     * things to be told before authorising an erasure.
     */
    if (exclusions.length > 0) {
      out.push('Deliberately **not** touched:');
      out.push('');
      for (const exclusion of exclusions) {
        const where = exclusion.table ? `${exclusion.system}.${exclusion.table}` : exclusion.system;
        out.push(`- ${where} — ${exclusion.count} record(s) — ${exclusion.reason}`);
      }
    } else {
      out.push('No exclusions were recorded: everything in scope is in the table above.');
    }
    out.push('');
  }

  if (certificate?.failure_reason) {
    out.push(`**Why it failed.** ${certificate.failure_reason}`);
    out.push('');
  }

  // What happens on "no" is part of the decision, and it is the half people are
  // never told. Saying it here is what makes this answerable without asking.
  out.push('**If you say no:** nothing is applied. The change stays sealed, this pull request is unaffected,');
  out.push('and the proof stays on the record so the next attempt starts from what was already established.');
  out.push('');

  if (certificate?.status === 'PROVEN') {
    out.push(`**Approve or refuse:** ${link}`);
    out.push('');
    out.push('> Approval is the only step in this change that a human performs, and it cannot be automated.');
    out.push('> There is no auto-approve, no default-yes and no timeout that resolves to approval.');
  } else {
    out.push('The gate is sealed. There is nothing to approve until a certificate is proven.');
  }

  return out.join('\n');
}


/**
 * Should this certificate be delivered, and is it safe to do so twice?
 *
 * Separated from the posting so the idempotence rule is a testable fact rather
 * than a comment. Posting the same certificate twice onto somebody else's pull
 * request is the kind of mistake that is never forgiven, so the condition is
 * written once, here, and asserted.
 */
export function shouldDeliverCertificate(dossier: Dossier): boolean {
  const origin = dossier.origin;
  if (!origin || origin.kind !== 'pull_request') return false;
  if (!origin.pr_number) return false;
  if (origin.notified_at !== null) return false;
  return dossier.certificate !== undefined;
}
