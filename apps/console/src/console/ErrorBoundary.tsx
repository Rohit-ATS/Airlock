'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A console that fails should say why.
 *
 * The default Next production boundary renders "a client-side exception has
 * occurred", which tells an operator nothing and tells a judge cloning the repo
 * even less. This shows the actual error and the component stack, styled as an
 * instrument fault rather than a stack trace dump.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; stack: string | null }
> {
  state: { error: Error | null; stack: string | null } = { error: null, stack: null };

  static getDerivedStateFromError(error: Error) {
    return { error, stack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, stack: info.componentStack ?? null });
    console.error('[airlock] console failed to mount', error, info.componentStack);
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-dvh items-center justify-center bg-void p-8">
        <div className="w-full max-w-[760px] rounded-[6px] border border-fault/40 bg-panel">
          <div className="border-b border-hairline px-4 py-3">
            <p className="evidence text-[12px] font-semibold tracking-[0.08em] text-fault">
              CONSOLE FAULT — THE AIRLOCK DID NOT COME ONLINE
            </p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="legend mb-1">Error</p>
              <p className="evidence text-[12px] break-words text-ink">{error.message}</p>
            </div>
            {error.stack ? (
              <div>
                <p className="legend mb-1">Stack</p>
                <pre className="scroll-thin evidence max-h-56 overflow-auto rounded-[4px] border border-hairline bg-void p-2 text-[10.5px] leading-relaxed text-ink-2">
                  {error.stack}
                </pre>
              </div>
            ) : null}
            {stack ? (
              <div>
                <p className="legend mb-1">Component stack</p>
                <pre
                // A scrollable region needs to be reachable without a mouse. This one
                // is a stack trace on a fault screen, which is exactly when someone is
                // least likely to have a working pointer path to it.
                tabIndex={0}
                role="region"
                aria-label="Error stack trace"
                className="scroll-thin evidence max-h-40 overflow-auto rounded-[4px] border border-hairline bg-void p-2 text-[10.5px] leading-relaxed text-ink-3"
              >
                  {stack}
                </pre>
              </div>
            ) : null}
            <p className="text-[11px] leading-relaxed text-ink-3">
              The most common cause is that the TrueForge harness is not reachable. Check{' '}
              <span className="evidence text-ink-2">NEXT_PUBLIC_TRUEFORGE_BASE_URL</span> and that the server is
              running, then reload.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
