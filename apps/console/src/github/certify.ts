import { airlockAgentName } from '@/data/env';
import { putDossier } from '@/data/dossierStore';
import { deriveBrief } from '@airlock/contract';
import { listChangedFiles, readFileAtRef } from '@/github/client';
import { openSession, startTurn, superviseInBackground } from '@/server/harnessRuns';

/**
 * Open a change for a pull request, with nobody present.
 *
 * This is the whole trigger, factored out of the webhook route because two
 * things need it — the webhook, which reacts, and the scheduled sweep, which
 * goes looking — and because a Next route file may only export handlers.
 *
 * The two callers differ in one field: how the change says it was found. A
 * sweep result is not the same claim as a webhook result. One means the system
 * was told; the other means it noticed.
 */

const AGENT_NAME = airlockAgentName();

export interface CertifyResult {
  status: number;
  body: Record<string, unknown>;
}

export async function certifyPullRequest(input: {
  repo: string;
  pull: number;
  headSha: string;
  author: string;
  startedBy: 'webhook' | 'schedule';
}): Promise<CertifyResult> {
  // Only migrations open a change. Everything else is somebody else's problem.
  const files = await listChangedFiles(input.repo, input.pull);
  const migrations = files.filter((f) => f.startsWith('migrations/'));
  if (migrations.length === 0) {
    return { status: 200, body: { ok: true, ignored: 'no files under migrations/' } };
  }

  /*
   * Read the SQL, not the file names.
   *
   * The old version knew only that `migrations/003.sql` had changed and told
   * the agent to go and look. Reading it here means the brief is about the
   * statements themselves, and it means the proof is pinned to a commit: every
   * file is read at `headSha`, so the certificate is about the bytes that were
   * on the branch and not about whatever it says an hour later.
   */
  const sources: Array<{ path: string; sql: string }> = [];
  for (const path of migrations) {
    const sql = await readFileAtRef(input.repo, path, input.headSha);
    if (sql !== null) sources.push({ path, sql });
  }
  if (sources.length === 0) {
    return { status: 200, body: { ok: true, ignored: 'migration files could not be read at head' } };
  }

  const brief = deriveBrief({ repo: input.repo, pull: input.pull, headSha: input.headSha, files: sources });
  const sessionId = await openHarnessSession(brief.text);

  /*
   * Keyed by head, not by time.
   *
   * `synchronize` fires on every push to the branch, and a webhook can be
   * redelivered. Deriving the id from the commit means the same bytes produce
   * the same change rather than a new one each time, and a new push — which is
   * genuinely a different thing to certify — produces a new one.
   */
  const dossierId = `dos_pr_${input.pull}_${input.headSha.slice(0, 7)}`;
  const dossier = await putDossier({
    dossier_id: dossierId,
    change_class: 'SCHEMA_MIGRATION',
    request: brief.text,
    requested_by: `github:${input.author}`,
    started_by: input.startedBy,
    created_at: new Date().toISOString(),
    session_id: sessionId,
    target: { systems: ['postgres'] },
    origin: {
      kind: input.startedBy === 'schedule' ? 'sweep' : 'pull_request',
      repo: input.repo,
      pr_number: input.pull,
      head_sha: input.headSha,
      paths: migrations,
      detected_at: new Date().toISOString(),
      notified_at: null,
    },
    // No certificate. The run has to earn one; until then the gate is sealed
    // and the console renders no approval control for it.
  });

  return {
    status: 202,
    body: {
      ok: true,
      dossier_id: dossier.dossier_id,
      session_id: sessionId,
      severity: brief.severity,
      statements: brief.statements.length,
      findings: brief.findings.length,
    },
  };
}

/**
 * Open a TrueForge session, start the turn, and see it through.
 *
 * Non-streaming: the webhook answers immediately and the run continues on the
 * server, which is exactly why session durability matters. Nothing here waits
 * for the agent — if this blocked, GitHub would time out the delivery and the
 * trigger would look flaky rather than asynchronous.
 *
 * What *is* new is that the run is now supervised rather than abandoned. This
 * function used to post the turn and return, and a turn that died on a provider
 * rate limit — the normal outcome of a real change-control run against a
 * 30k-tokens-per-minute ceiling — took the whole change with it: sealed
 * dossier, no certificate, nobody asked, and a queue entry that looks like work
 * in progress forever. `superviseInBackground` polls the turn and resumes it
 * where the provider asked us to, and stops the moment the run reaches a human.
 * See `server/harnessRuns.ts`.
 */
export async function openHarnessSession(message: string): Promise<string | null> {
  const sessionId = await openSession(AGENT_NAME);
  if (!sessionId) return null;

  const turnId = await startTurn(sessionId, message);
  // A session that exists is still worth recording against the dossier even if
  // the first turn did not take — it is the handle an operator needs to go and
  // look. But there is nothing to supervise.
  if (turnId) superviseInBackground(sessionId, turnId);

  return sessionId;
}
