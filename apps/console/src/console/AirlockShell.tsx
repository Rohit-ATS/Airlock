'use client';

import { useMemo, useRef } from 'react';
import { TrueForgeUI } from '@truefoundry/trueforge-ui';
import type { SemanticTokens } from '@truefoundry/trueforge-ui';
import { RunStore } from '@/harness/store';
import { HarnessProvider } from '@/harness/HarnessProvider';
import { createAirlockServer } from '@/server/observedServer';
import { AirlockConsole } from './AirlockConsole';
import { Mark } from './Mark';

/**
 * The AIRLOCK shell.
 *
 * This is capability 20, and the reason it is honest: the console is not a
 * lookalike built beside the SDK. `TrueForgeUI` mounts its full provider stack
 * and renders `AirlockConsole` as its layout, so the transcript, composer,
 * thread list, tool-approval cards, ask-user cards and MCP OAuth flow are all
 * the SDK's own components running inside our chrome.
 *
 * The server is the real TrueForge adapter, wrapped so the turn stream is
 * observed on its way past — see server/observedServer.ts.
 */

/** AIRLOCK, expressed in the SDK's semantic tokens so its surfaces match ours. */
const TOKENS: Partial<SemanticTokens> = {
  sidebarBg: '#0b0d11',
  topbarBg: '#0b0d11',
  primaryBg: '#07080a',
  secondaryBg: '#10131a',
  cardBg: '#10131a',
  border: '#1c212b',

  textPrimary: '#e8ecf2',
  textSecondary: '#b4bece',

  inputBoxBg: '#10131a',
  inputBorder: '#29313d',

  userMessageBg: '#141c24',
  userMessageText: '#e8ecf2',
  assistantMessageBg: 'transparent',
  assistantMessageText: '#e8ecf2',

  primaryButtonBg: '#0e2b39',
  primaryButtonHover: '#0d354a',
  primaryButtonText: '#4fc3f7',
  secondaryButtonBg: '#161a23',
  secondaryButtonHover: '#1d222d',
  secondaryButtonText: '#e8ecf2',
  ghostButtonBg: 'transparent',
  ghostButtonHover: '#161a23',
  ghostButtonText: '#b4bece',

  dropdownSelectedItemBg: '#161a23',
  dropdownSelectedItemText: '#e8ecf2',

  successBg: '#0b3729',
  successText: '#35d6a4',
  // The alarm colour, and nowhere else in the token map.
  warningBg: '#43230b',
  warningText: '#ff9130',
  failureBg: '#421419',
  failureText: '#ff5257',

  focusRing: '#4fc3f7',
  radius: '5px',
  composerRadius: '6px',
  overlay: 'rgba(7, 8, 10, 0.78)',
  shadowColor: 'rgba(0, 0, 0, 0.6)',
  scrollbarThumb: '#29313d',
  fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
};

/**
 * Both of these must be module-level constants, not inline literals.
 *
 * `TrueForgeUI` derives internal stores from these props; a fresh object (or a
 * fresh component identity for a slot override) on every render churns those
 * stores and trips React's "getSnapshot should be cached" invariant. Defining
 * them once also stops `BrandLogo` remounting on every keystroke.
 */
const BrandLogo = () => <Mark size={17} />;
const OVERRIDES = { BrandLogo } as const;

/** Surfacing beats swallowing: an operator needs to know the console lost its server. */
const onHarnessError = (error: unknown) => {
  console.error('[airlock] harness error', error);
};

const THEME = {
  preset: 'trueforge',
  mode: 'dark',
  tokens: TOKENS,
  brand: { name: 'AIRLOCK' },
  classNames: { markdown: 'aui-markdown' },
} as const;

export function AirlockShell({ baseUrl, agentName }: { baseUrl: string; agentName: string }) {
  // One store for the lifetime of the page; the observer writes into it from
  // outside React, and components read it through useSyncExternalStore.
  const storeRef = useRef<RunStore>(null);
  if (storeRef.current === null) storeRef.current = new RunStore();
  const store = storeRef.current;

  const server = useMemo(
    () =>
      createAirlockServer({
        baseUrl,
        // Every session in this console runs the change-control agent, so the
        // airlock MCP server is always mounted and the gate is always in the
        // loop. A console that could talk to a bare model would be a chat
        // window with an airlock painted on it.
        agentName,
        hooks: {
          onEvent: (event) => store.ingest(event),
          onStreamOpen: ({ sessionId, resumed }) => {
            store.noteStreamOpen(sessionId, resumed);
            if (resumed) {
              // A stream that reattaches and keeps its history is exactly what
              // session durability and replica failover look like from here.
              store.prove(16, 'turn stream reattached to an existing session with history intact', sessionId);
            }
          },
          onStreamClose: ({ error }) => store.noteStreamClose(error),
        },
      }),
    [baseUrl, agentName, store],
  );

  /**
   * The kill control.
   *
   * Approval stops a change before it starts; this is the only thing that stops
   * one already running. It goes through the harness rather than the browser
   * closing a stream, because the work is happening on an executor somewhere
   * else — TrueForge peers the cancellation over Redis so it lands on whichever
   * replica is actually doing it, not merely on the one that took this request.
   */
  const controls = useMemo(
    () => ({
      abort: async () => {
        const { sessionId } = store.getSnapshot();
        if (!sessionId) return;
        store.noteAborting();
        try {
          await server.cancelSession({ sessionId });
        } catch (error) {
          // The turn may already have finished on its own. That is not a
          // failure worth shouting about, but it must not leave the button
          // stuck saying "stopping".
          console.warn('[airlock] cancel did not land', error);
          store.noteStreamClose();
        }
      },
    }),
    [server, store],
  );

  return (
    <HarnessProvider store={store} controls={controls}>
      <TrueForgeUI
        server={server}
        layout={AirlockConsole}
        className="h-full min-h-0"
        theme={THEME}
        overrides={OVERRIDES}
        onError={onHarnessError}
      />
    </HarnessProvider>
  );
}
