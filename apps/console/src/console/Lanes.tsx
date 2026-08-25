'use client';

import { useEffect, useRef, useState } from 'react';
import type { LaneState } from '@/harness/store';
import { Chip, Dot, Evidence, Legend, cx } from '@/design/primitives';
import { useRun } from '@/harness/HarnessProvider';

/**
 * Subagent lanes.
 *
 * Each lane is a real harness thread: it appears on `thread.created` and closes
 * on `thread.done`. The model label comes from `agentInfo.model` on the same
 * event, so what you see is what the harness actually routed the work to — the
 * console has no say in it.
 */

function useTicker(active: boolean): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);
  return 0;
}

function elapsed(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Short display form for a model FQN: `anthropic/claude-sonnet-4-6` -> `claude-sonnet-4-6`. */
function shortModel(model: string): string {
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function Lane({ lane }: { lane: LaneState }) {
  useTicker(lane.status === 'running');
  const running = lane.status === 'running';
  const last = lane.toolCalls[lane.toolCalls.length - 1];

  return (
    <div
      className={cx(
        'relative min-w-[190px] flex-1 overflow-hidden rounded-[5px] border bg-raised px-2.5 py-2 transition-colors',
        running ? 'border-ice-dim/55' : lane.status === 'error' ? 'border-fault/40' : 'border-hairline',
      )}
    >
      {running ? (
        <div className="sweep absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-ice/12" aria-hidden />
      ) : null}

      <div className="flex items-center gap-1.5">
        <Dot tone={running ? 'ice' : lane.status === 'error' ? 'fault' : 'seal'} pulse={running} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">{lane.title}</span>
        <Evidence size="xs" dim>
          {elapsed(lane.startedAt, lane.endedAt)}
        </Evidence>
      </div>

      {lane.model ? (
        <div className="mt-1.5">
          <Chip tone="neutral" mono className="!text-[9.5px]" title={lane.model}>
            {shortModel(lane.model)}
          </Chip>
        </div>
      ) : null}

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <Evidence size="xs" className="min-w-0 flex-1 truncate text-ink-3">
          {last ? `${last.server ? `${last.server}·` : ''}${last.name}` : running ? 'thinking…' : 'complete'}
        </Evidence>
        <Evidence size="xs" dim>
          {lane.toolCalls.length} calls
        </Evidence>
      </div>

      {lane.tokensIn + lane.tokensOut > 0 ? (
        <Evidence size="xs" className="mt-1 block text-ink-4">
          {(lane.tokensIn + lane.tokensOut).toLocaleString()} tok
        </Evidence>
      ) : null}
    </div>
  );
}

export function Lanes() {
  const run = useRun();
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the newest lane in view as the fan-out grows.
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' });
  }, [run.lanes.length]);

  if (run.lanes.length === 0) return null;

  const running = run.lanes.filter((l) => l.status === 'running').length;

  return (
    <div className="shrink-0 border-b border-hairline px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Legend>Subagent lanes</Legend>
        <div className="h-px flex-1 bg-hairline" />
        {running > 0 ? (
          <Evidence size="xs" className="text-ice">
            {running} running
          </Evidence>
        ) : (
          <Evidence size="xs" dim>
            all complete
          </Evidence>
        )}
        {run.models.length > 1 ? (
          <Chip tone="ice" className="!text-[9.5px]" title={run.models.join(' · ')}>
            {run.models.length} models
          </Chip>
        ) : null}
      </div>

      <div ref={scroller} className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {run.lanes.map((lane) => (
          <Lane key={lane.threadId} lane={lane} />
        ))}
      </div>
    </div>
  );
}

/**
 * The sandbox log. Tool calls and their results as they stream, in the order
 * the harness produced them.
 */
export function SandboxLog({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const run = useRun();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [run.sandboxLog.length, collapsed]);

  return (
    <div className="shrink-0 border-t border-hairline bg-panel">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 transition-colors hover:bg-raised-2"
      >
        <Legend>Sandbox</Legend>
        {run.sandboxId ? (
          <Evidence size="xs" className="text-seal">
            {run.sandboxId.slice(0, 12)}
          </Evidence>
        ) : (
          <Evidence size="xs" dim>
            not provisioned
          </Evidence>
        )}
        <div className="h-px flex-1 bg-hairline" />
        <Evidence size="xs" dim>
          {run.sandboxLog.length} lines
        </Evidence>
        <span className={cx('text-ink-3 transition-transform', collapsed ? '' : 'rotate-180')}>⌃</span>
      </button>

      {!collapsed ? (
        <div className="scroll-thin h-[148px] overflow-y-auto border-t border-hairline bg-void px-3 py-1.5">
          {run.sandboxLog.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-ink-4">
              Nothing has run in the sandbox yet.
            </p>
          ) : (
            run.sandboxLog.map((line, i) => (
              // `data-step-id` is the anchor a traced figure on the certificate
              // scrolls to. Same id the harness ledger stamps on a capability
              // proof, so a number and the line that produced it can be joined.
              <div key={i} data-step-id={line.stepId ?? undefined} className="log-line flex gap-2 py-[1px]">
                <Evidence size="xs" className="shrink-0 text-ink-4">
                  {new Date(line.at).toLocaleTimeString('en-GB', { hour12: false })}
                </Evidence>
                <Evidence
                  size="xs"
                  className={cx(
                    'min-w-0 flex-1 break-words whitespace-pre-wrap',
                    line.kind === 'tool' ? 'text-ice' : line.kind === 'system' ? 'text-seal' : 'text-ink-3',
                  )}
                >
                  {line.kind === 'tool' ? '→ ' : line.kind === 'result' ? '  ' : '● '}
                  {line.text}
                </Evidence>
              </div>
            ))
          )}
          <div ref={end} />
        </div>
      ) : null}
    </div>
  );
}
