'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { BudgetPolicy } from '@airlock/contract';
import { ErrorBoundary } from '@/console/ErrorBoundary';
import { Button } from '@/design/primitives';

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

function Waiting({
  note,
  detail,
  onRetry,
}: {
  note: string;
  /** The machine-readable reason, when there is one. */
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-void px-8 text-center">
      <p className="legend">{note}</p>
      {detail ? <p className="evidence max-w-[560px] text-[11px] break-words text-ink-3">{detail}</p> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
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

/** What went wrong, in the shape the failure screen needs to explain it. */
interface Failure {
  /** The HTTP status, or null when the request never got an answer at all. */
  status: number | null;
  detail: string;
}

/**
 * Per-attempt ceiling. A server that accepts the connection and then never
 * answers is a real failure mode, and without this it renders as a console
 * sitting on "Reading configuration…" forever, saying nothing.
 */
const CONFIG_TIMEOUT_MS = 10_000;

/**
 * Waits between attempts; the length of this array is the retry count.
 *
 * Config used to be fetched exactly once, and that turned every transient
 * hiccup into a permanent dead end: `next dev` compiles a route handler on
 * first request and resets the connection until it is ready, an edit restarts
 * the server, a reload lands mid-boot. Any one of those flipped the console to
 * "Is the server running?" — about a server that was answering fine a second
 * later — with no way back except knowing to reload the browser.
 */
const CONFIG_BACKOFF_MS = [300, 900, 2_000];

type Attempt = { ok: true; config: Config } | ({ ok: false } & Failure);

async function requestConfig(outer: AbortSignal): Promise<Attempt> {
  // Two things can cut this short: the component unmounting, or the attempt
  // running long. `AbortSignal.any` would compose them in one line but is too
  // recent to rely on in whatever browser this gets opened in, so wire it up
  // by hand.
  const control = new AbortController();
  const abort = () => control.abort();
  outer.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, CONFIG_TIMEOUT_MS);

  try {
    // `no-store` because the point of asking at runtime is to get the value
    // this process has now, not one a cache saw at boot.
    const res = await fetch('/api/config', { signal: control.signal, cache: 'no-store' });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        detail: `GET /api/config responded ${res.status} ${res.statusText}`.trimEnd(),
      };
    }
    return { ok: true, config: (await res.json()) as Config };
  } catch (error) {
    if (outer.aborted) return { ok: false, status: null, detail: 'cancelled' };
    return {
      ok: false,
      status: null,
      detail: control.signal.aborted
        ? `GET /api/config did not answer within ${CONFIG_TIMEOUT_MS / 1000}s`
        : `GET /api/config could not be reached — ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', abort);
  }
}

/** A delay that gives up the moment the caller is abandoned. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
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
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Bumped by "Try again"; re-running the effect is the whole retry. */
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const control = new AbortController();

    void (async () => {
      setFailure(null);

      for (let i = 0; ; i++) {
        const result = await requestConfig(control.signal);
        if (control.signal.aborted) return;

        if (result.ok) {
          setConfig(result.config);
          return;
        }

        // A 404 is not a hiccup. It means nothing is serving the route — a
        // static export, or a build without it — and no amount of waiting
        // turns that into a 200.
        if (result.status === 404 || i >= CONFIG_BACKOFF_MS.length) {
          setFailure({ status: result.status, detail: result.detail });
          return;
        }

        await pause(CONFIG_BACKOFF_MS[i], control.signal);
        if (control.signal.aborted) return;
      }
    })();

    return () => control.abort();
  }, [reload]);

  if (failure) {
    // Say which of the failures this is. The repository has paid for the
    // difference before: one vague sentence covering "no server", "wrong
    // build" and "the server threw" costs an hour of looking in the wrong
    // place.
    const note = isStaticPagesBuild
      ? 'This GitHub Pages build is static. The live console needs a running backend or harness deployment.'
      : failure.status === 404
        ? 'Nothing here serves /api/config. The console needs the Next server — npm run dev — not a static export.'
        : failure.status !== null
          ? 'The server answered, but could not read its own configuration.'
          : 'The console could not reach its own server. Is it still running?';

    return (
      <div className="fixed inset-0 overflow-hidden">
        <Waiting
          note={note}
          detail={failure.detail}
          // Pointless on a static export: there is no server to come back.
          onRetry={isStaticPagesBuild ? undefined : () => setReload((n) => n + 1)}
        />
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
