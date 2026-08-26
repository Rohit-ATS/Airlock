import { renderCertificateComment, shouldDeliverCertificate, type Dossier } from '@airlock/contract';
import { env } from '@/data/env';
import { postPullRequestComment } from '@/github/client';

/**
 * Post the certificate back to the pull request that started the change.
 *
 * The autonomy claim has two halves and this is the second. A run that starts
 * by itself but reports into a console nobody opened has not removed a human
 * step, it has moved one: somebody still has to go and look. So the certificate
 * goes back to where the engineer already was.
 *
 * Everything worth testing — whether to deliver, and what it says — lives in
 * `@airlock/contract`. What is left here is the network call and the stamp.
 *
 * Returns the dossier with `notified_at` set when it was delivered, or null
 * when there was nothing to do or the post did not land. A failure must read as
 * "not delivered" and never be stamped optimistically, because the stamp is the
 * only thing stopping a second copy appearing on somebody's pull request.
 */
export async function deliverCertificate(dossier: Dossier): Promise<Dossier | null> {
  if (!shouldDeliverCertificate(dossier)) return null;

  const origin = dossier.origin;
  // `shouldDeliverCertificate` has already established both of these; the checks
  // are here to narrow the types rather than to decide anything.
  if (!origin?.pr_number) return null;

  const body = renderCertificateComment(dossier, {
    consoleUrl: env('AIRLOCK_CONSOLE_URL') ?? 'http://localhost:3000',
  });

  const url = await postPullRequestComment(origin.repo, origin.pr_number, body);
  if (url === null) return null;

  return { ...dossier, origin: { ...origin, notified_at: new Date().toISOString() } };
}
