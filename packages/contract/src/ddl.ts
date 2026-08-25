/**
 * Destructive DDL classification.
 *
 * The verifier can prove an unsafe migration reversible, but it should also say
 * why it is unsafe. A column drop is not merely an `ALTER TABLE`: it is the
 * contract breaking underneath every reader that still names the column.
 */

export type DdlRiskKind = 'DROP_COLUMN' | 'DROP_TABLE' | 'DROP_INDEX' | 'RENAME_COLUMN' | 'ADD_NOT_NULL_COLUMN';
export type DdlSeverity = 'safe' | 'caution' | 'destructive';

export interface DdlFinding {
  kind: DdlRiskKind;
  severity: DdlSeverity;
  table?: string;
  column?: string;
  object?: string;
  statement: string;
  reason: string;
}

export interface ExpandContractStep {
  phase: 'expand' | 'migrate' | 'contract';
  statement: string;
  why: string;
}

/**
 * Strip line comments and collapse runs of whitespace.
 *
 * The SQL reaching this comes off a change dossier, which is to say from the
 * agent, which is to say ultimately from whatever it read. It is untrusted
 * input and it can be long. The previous pair — `/--.*$/gm` then `/\s+/g` —
 * gave a backtracking engine a superlinear worst case on exactly that kind of
 * input, and a classifier that can be made to hang is a gate that can be made
 * to hang.
 *
 * Splitting on a newline and cutting at the first `--` is the same
 * transformation with no quantifier to backtrack over: one pass, linear in the
 * length of the input, whatever the input is.
 */
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

const clean = (sql: string): string => {
  const words: string[] = [];
  let word = '';

  for (const line of sql.split('\n')) {
    const comment = line.indexOf('--');
    const code = comment === -1 ? line : line.slice(0, comment);
    for (const ch of code) {
      if (WHITESPACE.has(ch)) {
        if (word) {
          words.push(word);
          word = '';
        }
      } else {
        word += ch;
      }
    }
    // A newline separates words even when the line ended mid-token.
    if (word) {
      words.push(word);
      word = '';
    }
  }

  return words.join(' ');
};
const ident = String.raw`(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))`;

function name(...groups: Array<string | undefined>): string | undefined {
  return groups.find((group) => group !== undefined);
}

export function classifyDdl(statements: readonly string[]): DdlFinding[] {
  const findings: DdlFinding[] = [];

  for (const raw of statements) {
    const statement = clean(raw).replace(/;$/, '');
    if (!statement) continue;

    const dropColumn = new RegExp(
      String.raw`^ALTER\s+TABLE\s+${ident}\s+DROP\s+COLUMN(?:\s+IF\s+EXISTS)?\s+${ident}(?:\s|$)`,
      'i',
    ).exec(statement);
    if (dropColumn) {
      const table = name(dropColumn[1], dropColumn[2]);
      const column = name(dropColumn[3], dropColumn[4]);
      findings.push({
        kind: 'DROP_COLUMN',
        severity: 'destructive',
        table,
        column,
        statement: raw,
        reason: `Dropping ${table}.${column} breaks any reader that still selects, writes or serialises that column.`,
      });
      continue;
    }

    const renameColumn = new RegExp(
      String.raw`^ALTER\s+TABLE\s+${ident}\s+RENAME\s+COLUMN\s+${ident}\s+TO\s+${ident}(?:\s|$)`,
      'i',
    ).exec(statement);
    if (renameColumn) {
      const table = name(renameColumn[1], renameColumn[2]);
      const column = name(renameColumn[3], renameColumn[4]);
      const next = name(renameColumn[5], renameColumn[6]);
      findings.push({
        kind: 'RENAME_COLUMN',
        severity: 'destructive',
        table,
        column,
        object: next,
        statement: raw,
        reason: `Renaming ${table}.${column} to ${next} breaks callers until the old and new names are supported together.`,
      });
      continue;
    }

    const dropTable = new RegExp(String.raw`^DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+${ident}(?:\s|$)`, 'i').exec(statement);
    if (dropTable) {
      const object = name(dropTable[1], dropTable[2]);
      findings.push({
        kind: 'DROP_TABLE',
        severity: 'destructive',
        object,
        statement: raw,
        reason: `Dropping table ${object} destroys the storage boundary and every relation attached to it.`,
      });
      continue;
    }

    const addRequired = new RegExp(
      String.raw`^ALTER\s+TABLE\s+${ident}\s+ADD\s+COLUMN\s+${ident}(?:\s|$)(?=.*\bNOT\s+NULL\b)(?!.*\bDEFAULT\b)`,
      'i',
    ).exec(statement);
    if (addRequired) {
      const table = name(addRequired[1], addRequired[2]);
      const column = name(addRequired[3], addRequired[4]);
      findings.push({
        kind: 'ADD_NOT_NULL_COLUMN',
        severity: 'caution',
        table,
        column,
        statement: raw,
        reason: `Adding ${table}.${column} as NOT NULL without a default can fail or lock while existing rows are rewritten.`,
      });
      continue;
    }

    const dropIndex = new RegExp(String.raw`^DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+${ident}(?:\s|$)`, 'i').exec(statement);
    if (dropIndex) {
      const object = name(dropIndex[1], dropIndex[2]);
      findings.push({
        kind: 'DROP_INDEX',
        severity: 'caution',
        object,
        statement: raw,
        reason: `Dropping index ${object} can turn previously cheap production paths into table scans.`,
      });
    }
  }

  return findings;
}

export function expandContractPlan(finding: DdlFinding): ExpandContractStep[] {
  if (finding.kind !== 'DROP_COLUMN' || !finding.table || !finding.column) return [];

  const { table, column } = finding;
  const replacement = `${column}_v2`;
  return [
    {
      phase: 'expand',
      statement: `ALTER TABLE ${table} ADD COLUMN ${replacement} TEXT;`,
      why: `Add the replacement column while ${table}.${column} still exists, so old readers keep working.`,
    },
    {
      phase: 'migrate',
      statement: `UPDATE ${table} SET ${replacement} = ${column} WHERE ${replacement} IS NULL;`,
      why: 'Backfill in a separate phase that can be batched and measured.',
    },
    {
      phase: 'contract',
      statement: `ALTER TABLE ${table} DROP COLUMN ${column};`,
      why: 'Drop the old column only after application code and readers have moved to the replacement.',
    },
  ];
}
