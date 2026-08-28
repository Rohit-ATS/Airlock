'use client';

import { useEffect, useState } from 'react';
import { cx, Dot } from './primitives';

/**
 * "You can approve things here because nobody is checking who you are."
 *
 * AIRLOCK grants the approver role to a local operator when no identity
 * provider is configured, because the alternative — a fresh clone where every
 * approve control is missing and nothing explains why — makes the product
 * impossible to evaluate and looks broken rather than strict.
 *
 * That grant is only defensible if the console says so, permanently and where
 * the decision is made. A role handed out because there is no authentication
 * must never render like one somebody issued: the entire argument of this
 * project is that an unsourced claim says it is unsourced, and "you are an
 * approver" is a claim like any other.
 *
 * So this banner is deliberately not dismissible. Every other notice in the
 * console reports an event that has passed; this one reports a standing
 * property of the deployment, and it stops being true only when the deployment
 * changes. A dismissible caveat is a caveat that is absent from the screenshot.
 */
export function StandaloneNotice({ className }: { className?: string }) {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/me');
        if (!res.ok || !live) return;
        const me = (await res.json()) as { standalone?: boolean };
        if (live) setStandalone(me.standalone === true);
      } catch {
        /* If we cannot ask, we do not assert. No banner is better than a wrong one. */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!standalone) return null;

  return (
    <div
      role="status"
      className={cx(
        'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-hazard/40 bg-hazard-bg px-3 py-2',
        className,
      )}
    >
      <Dot tone="hazard" />
      <p className="text-[11.5px] leading-relaxed text-hazard">
        <span className="font-semibold">Standalone mode — no identity provider is configured.</span>{' '}
        <span className="text-hazard/85">
          You are acting as a single local operator and can approve your own changes. This is{' '}
          <em>not</em> separation of duties. Point the console at a harness, or set{' '}
          <code className="evidence">AIRLOCK_LOCAL_OPERATOR=0</code>, to require a real approver.
        </span>
      </p>
    </div>
  );
}
