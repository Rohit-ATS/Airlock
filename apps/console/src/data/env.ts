import fs from 'node:fs';
import path from 'node:path';

/**
 * Server-side environment, including the monorepo-root `.env`.
 *
 * Next reads `.env` from the *project* directory — `apps/console` — and there
 * isn't one there. Everything else in this repository (the MCP server, the
 * harness scripts, `npm run harness:setup`) reads the root `.env`, so a value
 * set in the obvious place was visible to every tool except the one that most
 * needed it.
 *
 * That failure was expensive because it was quiet. With
 * `TRUEFORGE_BASE_URL=http://localhost:8791` sitting in the root `.env`, the
 * console used its `:8790` default, failed every harness call with
 * ERR_CONNECTION_REFUSED, and rendered perfectly while doing it. Nothing on
 * screen said "wrong port". `AIRLOCK_BREAK_GLASS=1` was ignored the same way,
 * so the break-glass control never appeared however the deployment was set up.
 *
 * Setting `process.env` from `next.config.ts` does not fix it either: that runs
 * in the build/config context and the server runtime does not inherit the
 * mutation. So the file is read here, by the process that serves the request.
 *
 * `envSource()` is exported so the console can *say* which file it read.
 * Without that, a console pointed at the wrong server looks exactly like one
 * pointed at the right server until something fails.
 *
 * Real process environment always wins, so `FOO=x npm start` still overrides.
 */

interface Loaded {
  values: Record<string, string>;
  /** The file that was read, or null when none of the candidates existed. */
  source: string | null;
  searched: string[];
}

let cache: Loaded | null = null;

function candidates(): string[] {
  const cwd = process.cwd();
  return [
    // `next start` runs from apps/console; the repo root is two up.
    path.join(cwd, '..', '..', '.env'),
    // A standalone build, or `npm start` from the repo root.
    path.join(cwd, '.env'),
    path.join(cwd, '..', '.env'),
  ].map((p) => path.resolve(p));
}

/**
 * Parse `KEY=value` lines.
 *
 * Note the split: CRLF *or* LF. A `.env` written on Windows, or edited by two
 * different tools, has mixed endings — and in JavaScript a carriage return is a
 * line terminator, so `.` does not match it, while `$` without the `m` flag
 * matches only at end of input. The consequence is vicious: a line like
 *
 *     TRUEFORGE_BASE_URL=http://localhost:8791\r
 *
 * silently fails a regex that looks obviously correct, because `(.*)$` stops
 * before the carriage return and then cannot anchor. The *only* lines that
 * survive are empty ones, where `\s*` happens to swallow it.
 *
 * This is not hypothetical. It is what made this console locate its own `.env`,
 * report the correct path, and still read none of the values that mattered.
 */
function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (out[key] === undefined) out[key] = raw.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function load(): Loaded {
  if (cache) return cache;

  const searched = candidates();
  for (const file of searched) {
    try {
      if (!fs.existsSync(file)) continue;
      cache = { values: parse(fs.readFileSync(file, 'utf8')), source: file, searched };
      return cache;
    } catch {
      // An unreadable .env is not worth crashing a console over; try the next.
    }
  }

  cache = { values: {}, source: null, searched };
  return cache;
}

/** Which `.env` was read, and where it looked. Surfaced by `/api/config`. */
export function envSource(): { source: string | null; searched: string[]; keys: string[] } {
  const { source, searched, values } = load();
  // Key names only — never values. Enough to answer "did it read my file?"
  // without putting a credential in an HTTP response.
  return { source, searched, keys: Object.keys(values).sort() };
}

/** Read a variable, preferring the real process environment. */
export function env(name: string, fallback?: string): string | undefined {
  const live = process.env[name];
  if (live !== undefined && live !== '') return live;
  const fromFile = load().values[name];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return fallback;
}

/** Where the TrueForge server is, as this process can reach it. */
export function trueforgeBaseUrl(): string {
  return env('TRUEFORGE_BASE_URL') ?? env('NEXT_PUBLIC_TRUEFORGE_BASE_URL') ?? 'http://localhost:8790';
}

/** The agent every console session runs. */
export function airlockAgentName(): string {
  return (
    env('AIRLOCK_AGENT') ??
    env('AIRLOCK_AGENT_NAME') ??
    env('NEXT_PUBLIC_AIRLOCK_AGENT') ??
    'airlock-change-control'
  );
}

/**
 * Break-glass, deployment half. The policy half is per change class, and both
 * must say yes. Off unless explicitly "1" — an override that can be switched on
 * by a typo is not an override.
 */
export function breakGlassEnabled(): boolean {
  return env('AIRLOCK_BREAK_GLASS') === '1';
}

/** Where the change ledger is written. */
export function dataDir(): string {
  return env('AIRLOCK_DATA_DIR') ?? path.join(process.cwd(), '.airlock');
}

/** Whether to seed the console fixtures on first read. */
export function seedDisabled(): boolean {
  return env('AIRLOCK_NO_SEED') === '1';
}

/** The GitHub webhook secret. Absent means the webhook refuses everything. */
export function githubWebhookSecret(): string | undefined {
  return env('GITHUB_WEBHOOK_SECRET');
}
