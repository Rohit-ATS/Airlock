'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { BudgetPolicy } from '@airlock/contract';
import { ErrorBoundary } from '@/console/ErrorBoundary';

/**
 * The console is a live streaming surface with no useful server-rendered form,
 * so it is mounted client-side only. That also keeps the SDK's provider stack
 * out of the server bundle, where `window` does not exist.
 *
 * `ssr: false` is only permitted from a client component in the App Router,
 * which is why this file carries the directive.
 */
const AirlockShell = dynamic(() => import('@/console/AirlockShell').then((m) => m.AirlockShell), {
  ssr: false,
  loading: () => <Waiting note="Bringing the airlock online…" />,
});

function Waiting({ note }: { note: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-void">
      <p className="legend">{note}</p>
    </div>
  );
}

interface Config {
  /** Path on this origin that proxies the harness. */
  harnessPath: string;
  agentName: string;
  /** The run ceiling, read from the same policy document the gate uses. */
  budget: BudgetPolicy;
}

export default function Page() {
  const isStaticPagesBuild = process.env.NEXT_PUBLIC_GITHUB_PAGES === 'true';
  /**
   * Config is fetched, not inlined.
   *
   * It used to come from `process.env.NEXT_PUBLIC_TRUEFORGE_BASE_URL`, baked in
   * at build time. When that failed to resolve the console quietly used its
   * `:8790` default and then failed every call to the real harness on `:8791`,
   * with nothing on screen to say so. Asking the server at runtime removes the
   * whole class of problem, and means re-pointing the console is a restart
   * rather than a rebuild.
   */
  const [config, setConfig] = useState<Config | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Config;
        if (live) setConfig(body);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    const note = isStaticPagesBuild
      ? 'This GitHub Pages build is static. The live console needs a running backend or harness deployment.'
      : 'The console could not read its own configuration. Is the server running?';

    return (
      <div className="fixed inset-0 overflow-hidden">
        <Waiting note={note} />
      </div>
    );
  }

  return (
    // The console owns the viewport. Fixing it here rather than putting
    // `overflow: hidden` on the body keeps the landing page and the control
    // room — which are ordinary scrolling documents — able to scroll.
    <div className="fixed inset-0 overflow-hidden">
      <ErrorBoundary>
        {config ? (
          <AirlockShell
            // Absolute, but pointed at this origin: the console proxies the
            // harness at /harness because TrueForge sends no CORS headers and
            // a direct browser call fails before it arrives.
            baseUrl={new URL(config.harnessPath, window.location.origin).toString()}
            agentName={config.agentName}
            budget={config.budget}
          />
        ) : (
          <Waiting note="Reading configuration…" />
        )}
      </ErrorBoundary>
    </div>
  );
}
