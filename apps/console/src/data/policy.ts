import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_POLICY, parsePolicy, type Policy } from '@airlock/contract';

/**
 * The policy actually in force, loaded from `airlock.policy.yaml`.
 *
 * Policy is the half of the gate that belongs to the organisation rather than
 * to the change, so it has to be editable by the people who own it — without a
 * TypeScript build, and without a deploy of the console.
 *
 * Three properties this deliberately has:
 *
 *   - **Validated before use.** A typo'd key does not tighten a rule, it removes
 *     one. `max_peple: 1000` is an absent ceiling with a spelling mistake, and
 *     nobody would find out until an erasure went through that should not have.
 *     Unknown keys are a hard error.
 *   - **Falls back to the stricter shipped default**, never to nothing. A
 *     console that cannot read its policy must not conclude that everything is
 *     permitted.
 *   - **Says which policy it is using**, so "why did that go through" has an
 *     answer that does not require reading the source.
 */

export interface LoadedPolicy {
  policy: Policy;
  /** The file it came from, or null when the shipped default is in force. */
  source: string | null;
  /** Validation problems. Non-empty means the default is in force despite a file existing. */
  problems: string[];
}

let cache: LoadedPolicy | null = null;

function candidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, '..', '..', 'airlock.policy.yaml'),
    path.join(cwd, 'airlock.policy.yaml'),
    path.join(cwd, '..', 'airlock.policy.yaml'),
  ].map((p) => path.resolve(p));
}

export function loadPolicy(): LoadedPolicy {
  if (cache) return cache;

  for (const file of candidates()) {
    if (!fs.existsSync(file)) continue;

    let document: unknown;
    try {
      document = parseYaml(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[airlock] ${file} is not valid YAML — falling back to the shipped policy.\n  ${message}`);
      cache = { policy: DEFAULT_POLICY, source: null, problems: [`${file}: ${message}`] };
      return cache;
    }

    const result = parsePolicy(document);
    if (!result.ok) {
      console.error(
        `[airlock] ${file} is not a valid policy — falling back to the shipped policy:\n` +
          result.problems.map((p) => `  ${p}`).join('\n'),
      );
    }
    cache = {
      policy: result.policy,
      source: result.ok ? file : null,
      problems: result.problems,
    };
    return cache;
  }

  cache = { policy: DEFAULT_POLICY, source: null, problems: [] };
  return cache;
}

/** The policy to hand to `openGate`. */
export function activePolicy(): Policy {
  return loadPolicy().policy;
}
