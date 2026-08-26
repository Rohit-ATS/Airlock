import { classifyDdl, type DdlFinding } from './ddl.js';

/**
 * The run's task, derived from the diff.
 *
 * This is the part of the autonomy claim that is easy to fake and worth being
 * precise about. The old webhook wrote a sentence about the pull request —
 * "read the migration, work out what it does" — which is a human's instruction
 * stored in a template, restated on every run. The agent was still being told
 * what to do; the telling had just been written once in advance.
 *
 * What is built here is different in kind. The migration SQL is read at the
 * commit, classified by the same `classifyDdl` the gate uses, and the brief is
 * assembled from what was found: these statements, this severity, these tables
 * and columns. Change the diff and the brief changes with it, because it is a
 * description of the diff rather than a prompt about pull requests in general.
 *
 * No English is typed per change. The framing that remains is the shape of the
 * document, and it is generated from findings, not authored per run.
 */

export interface MigrationFile {
  path: string;
  sql: string;
}

export interface DerivedBrief {
  /** What the agent is asked to certify. */
  text: string;
  /** Everything the classifier found, so the caller can record it. */
  findings: DdlFinding[];
  /** The worst thing in the diff, which is what decides how loud this is. */
  severity: Severity;
  statements: string[];
}

/**
 * Split a SQL file into statements.
 *
 * Semicolon-delimited, ignoring semicolons inside quotes, dollar-quoted bodies
 * and line comments — enough for migration files, which is all this ever sees.
 * Written as a single pass with no backtracking, for the same reason `clean()`
 * in the contract is: this runs over content that arrived from a pull request.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let dollarTag: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      current += ch;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i++;
        blockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      current += ch;
      if (ch === '$' && sql.startsWith(dollarTag, i)) {
        current += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '-' && next === '-') {
      lineComment = true;
      current += ch;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '$') {
      // `$tag$` … `$tag$`, and the common bare `$$`.
      const close = sql.indexOf('$', i + 1);
      if (close !== -1 && /^[A-Za-z0-9_]*$/.test(sql.slice(i + 1, close))) {
        dollarTag = sql.slice(i, close + 1);
        current += dollarTag;
        i = close;
        continue;
      }
    }
    if (ch === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

type Severity = 'safe' | 'caution' | 'destructive';

/** Ranked so the loudest thing in the diff decides how loud the brief is. */
const WORST: Record<Severity, number> = { safe: 0, caution: 1, destructive: 2 };

export function deriveBrief(input: {
  repo: string;
  pull: number;
  headSha: string;
  files: readonly MigrationFile[];
}): DerivedBrief {
  const statements = input.files.flatMap((file) => splitStatements(file.sql));
  const findings = classifyDdl(statements);

  const severity = findings.reduce<Severity>(
    (worst, finding) => (WORST[finding.severity] > WORST[worst] ? finding.severity : worst),
    'safe',
  );

  const lines: string[] = [];

  // Facts first, in the order the gate will need them.
  lines.push(`repository ${input.repo}`);
  lines.push(`pull request #${input.pull} at ${input.headSha}`);
  lines.push(`migration files: ${input.files.map((f) => f.path).join(', ')}`);
  lines.push(`statements: ${statements.length}`);
  lines.push(`classifier verdict: ${severity}`);
  lines.push('');

  if (findings.length > 0) {
    lines.push('What the classifier found, statement by statement:');
    for (const finding of findings) {
      const object = finding.table
        ? finding.column
          ? `${finding.table}.${finding.column}`
          : finding.table
        : (finding.object ?? '');
      lines.push(`- ${finding.kind} (${finding.severity}) on ${object} — ${finding.reason}`);
    }
    lines.push('');
  } else {
    // Say so explicitly. Silence here would read as "nothing destructive was
    // checked for", which is a very different claim.
    lines.push('The classifier found no destructive DDL in these statements.');
    lines.push('');
  }

  lines.push('The SQL, verbatim, as it stands at that commit:');
  lines.push('');
  for (const file of input.files) {
    lines.push(`--- ${file.path}`);
    lines.push(file.sql.trim());
    lines.push('');
  }

  lines.push(
    'Certify this change: resolve the facts it depends on from the systems of record, ' +
      'prove the forward migration and its inverse against a shadow copy, and attach the ' +
      'certificate. Do not request approval without one.',
  );

  return { text: lines.join('\n'), findings, severity, statements };
}
