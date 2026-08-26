'use client';

import { useEffect, useState } from 'react';
import { cx, Dot, Evidence, Legend } from '@/design/primitives';
import type { ActivityStep } from '@airlock/contract';

/**
 * What the agent is doing, for runs this browser did not start.
 *
 * The DOING lane used to render from `RunStore`, which is fed only by a turn
 * this tab posted. Since AIRLOCK's argument is that nobody types anything, the
 * lane was blank for exactly the runs it exists to show. This reads
 * `/api/activity`, which asks the harness.
 *
 * It is deliberately a *feed* rather than a transcript. The question a judge is
 * asking at this point is not "what did the model say", it is "is this thing
 * actually doing something, and did a human touch it" — so what is rendered is
 * the sequence of acts: connectors opened, tools called, whether it stopped for
 * a person.
 */

interface Run {
  session_id: string;
  agent: string;
  created_at: string | null;
  status: 'idle' | 'running' | 'held' | 'done' | 'error';
  heldOn: string | null;
  steps: ActivityStep[];
  tools: string[];
  servers: string[];
}

interface Feed {
  reachable: boolean;
  runs: Run[];
  note?: string;
}

/** Poll in step with the change queue, so the two panels never disagree. */
const EVERY_MS = 4000;

export function useActivity(): Feed | null {
  const [feed, setFeed] = useState<Feed | null>(null);

  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const res = await fetch('/api/activity', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as Feed;
        if (live) setFeed(body);
      } catch {
        /* keep whatever we had; a blip is not a state change */
      }
    };
    void read();
    const id = setInterval(() => void read(), EVERY_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  return feed;
}

const TONE: Record<string, string> = {
  turn: 'text-ink-3',
  thinking: 'text-ink-2',
  tool: 'text-ice',
  connectors: 'text-seal',
  sandbox: 'text-seal',
  subagent: 'text-ice',
  held: 'text-hazard',
  asked: 'text-hazard',
  done: 'text-ink-3',
};

function clock(iso: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(11, 19);
}

function StatusLine({ run }: { run: Run }) {
  const tone =
    run.status === 'held' ? 'hazard' : run.status === 'error' ? 'fault' : run.status === 'running' ? 'ice' : 'neutral';

  return (
    <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
      <Dot tone={tone as never} pulse={run.status === 'running'} />
      <Evidence size="xs" className="text-ink">
        {run.status === 'held' ? `HELD — ${run.heldOn ?? 'a human'}` : run.status.toUpperCase()}
      </Evidence>
      <Evidence size="xs" className="ml-auto text-ink-4">
        {run.agent}
      </Evidence>
      <Evidence size="xs" className="text-ink-4">
        {run.session_id.slice(0, 10)}
      </Evidence>
    </div>
  );
}

export function LiveActivity({ feed }: { feed: Feed | null }) {
  if (!feed) {
    return (
      <div className="flex h-full items-center justify-center">
        <Legend>Reading the harness…</Legend>
      </div>
    );
  }

  if (!feed.reachable || feed.runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <Legend>No agent activity yet</Legend>
        <p className="max-w-[420px] text-[11.5px] leading-relaxed text-ink-3">
          {feed.reachable
            ? 'Nothing has run against the harness. Open a pull request touching migrations/, or drive one directly with npm run harness:turn.'
            : 'The harness could not be reached, so this is not "nothing happened" — it is "nobody could ask".'}
        </p>
      </div>
    );
  }

  const run = feed.runs[0];
  // Newest last reads like a log; the tail is what is happening now.
  const steps = run.steps.slice(-60);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatusLine run={run} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {steps.length === 0 ? (
          <div className="px-3 py-3">
            <Legend>The run has produced no events yet.</Legend>
          </div>
        ) : (
          <ol>
            {steps.map((step, i) => (
              <li
                key={`${step.at}-${i}`}
                className="flex gap-2 border-b border-hairline/60 px-3 py-1.5 last:border-b-0"
              >
                <Evidence size="xs" className="shrink-0 text-ink-4 tabular-nums">
                  {clock(step.at)}
                </Evidence>
                <Evidence size="xs" className={cx('shrink-0 uppercase', TONE[step.kind] ?? 'text-ink-3')}>
                  {step.kind}
                </Evidence>
                <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-2">
                  <span className="break-words">{step.label}</span>
                  {step.detail ? (
                    <span className="mt-0.5 block truncate text-[11px] text-ink-4">{step.detail}</span>
                  ) : null}
                </span>
                {step.thread !== 'main' ? (
                  <Evidence size="xs" className="shrink-0 text-ice">
                    {step.thread.slice(0, 8)}
                  </Evidence>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-hairline px-3 py-2">
        <Legend>{run.tools.length} tool call(s)</Legend>
        <Legend>{run.servers.length} connector(s)</Legend>
        <Legend className="ml-auto">
          {feed.runs.length} recent session{feed.runs.length === 1 ? '' : 's'}
        </Legend>
      </div>
    </div>
  );
}
