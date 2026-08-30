/**
 * Supabase branch lifecycle for AIRLOCK proofs.
 *
 * Verified against the Supabase Management API docs on 2026-08-30:
 *
 *   - POST   /v1/projects/{ref}/branches
 *   - GET    /v1/projects/{ref}/branches/{name}
 *   - GET    /v1/projects/{ref}/branches
 *   - DELETE /v1/branches/{branch_id_or_ref}
 *
 * The wrapper is small on purpose. The proof engine needs one guarantee above
 * all others: if a branch was created, it is torn down on every failure path.
 * Branches hold copied production data and may cost money; leaking one is both
 * a security and operational failure.
 */
export interface SupabaseBranchClientInput {
  projectRef: string;
  accessToken: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
}

export interface CreateBranchInput {
  name: string;
  gitBranch?: string;
  withData?: boolean;
  persistent?: boolean;
  region?: string;
  desiredInstanceSize?: string;
  notifyUrl?: string;
}

export interface SupabaseBranch {
  id: string | null;
  name: string;
  project_ref: string;
  parent_project_ref: string | null;
  status: string | null;
  preview_project_status: string | null;
  with_data: boolean | null;
  persistent: boolean | null;
}

export interface PollBranchInput {
  name: string;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

export class SupabaseBranchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const READY_STATUSES = new Set(['ACTIVE_HEALTHY', 'HEALTHY', 'ACTIVE', 'RUNNING']);
const FAILED_STATUSES = new Set(['FAILED', 'INACTIVE', 'REMOVED', 'DELETING_PROJECT', 'UNKNOWN']);

function cleanRef(ref: string): string {
  const out = ref.trim();
  if (!/^[a-z0-9-]+$/.test(out)) throw new SupabaseBranchError('Supabase project ref must be a lowercase project ref.');
  return out;
}

function cleanName(name: string): string {
  const out = name.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(out)) {
    throw new SupabaseBranchError('Supabase branch name may contain letters, numbers, dot, underscore, slash and dash only.');
  }
  return out;
}

function normalizeBranch(raw: unknown): SupabaseBranch {
  const row = raw as Record<string, unknown>;
  return {
    id: row.id === undefined || row.id === null ? null : String(row.id),
    name: String(row.name ?? row.branch_name ?? ''),
    project_ref: String(row.project_ref ?? ''),
    parent_project_ref: row.parent_project_ref === undefined || row.parent_project_ref === null ? null : String(row.parent_project_ref),
    status: row.status === undefined || row.status === null ? null : String(row.status),
    preview_project_status:
      row.preview_project_status === undefined || row.preview_project_status === null
        ? null
        : String(row.preview_project_status),
    with_data: typeof row.with_data === 'boolean' ? row.with_data : null,
    persistent: typeof row.persistent === 'boolean' ? row.persistent : null,
  };
}

function readyStatus(branch: SupabaseBranch): string | null {
  return (branch.preview_project_status ?? branch.status)?.toUpperCase() ?? null;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sbp_[A-Za-z0-9._-]+/g, 'sbp_[redacted]');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

export class SupabaseBranchClient {
  private readonly projectRef: string;
  private readonly accessToken: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: SupabaseBranchClientInput) {
    this.projectRef = cleanRef(input.projectRef);
    this.accessToken = input.accessToken.trim();
    this.apiBaseUrl = (input.apiBaseUrl ?? 'https://api.supabase.com').replace(/\/+$/, '');
    this.fetchImpl = input.fetch ?? fetch;
    if (!this.accessToken) throw new SupabaseBranchError('Supabase access token is required.');
  }

  async create(input: CreateBranchInput): Promise<SupabaseBranch> {
    const body: Record<string, unknown> = {
      branch_name: cleanName(input.name),
      with_data: input.withData ?? true,
      persistent: input.persistent ?? false,
    };
    if (input.gitBranch) body.git_branch = input.gitBranch;
    if (input.region) body.region = input.region;
    if (input.desiredInstanceSize) body.desired_instance_size = input.desiredInstanceSize;
    if (input.notifyUrl) body.notify_url = input.notifyUrl;

    return normalizeBranch(await this.request(`/v1/projects/${encodeURIComponent(this.projectRef)}/branches`, {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }

  async get(name: string): Promise<SupabaseBranch> {
    return normalizeBranch(
      await this.request(`/v1/projects/${encodeURIComponent(this.projectRef)}/branches/${encodeURIComponent(cleanName(name))}`),
    );
  }

  async list(): Promise<SupabaseBranch[]> {
    const rows = await this.request(`/v1/projects/${encodeURIComponent(this.projectRef)}/branches`);
    return Array.isArray(rows) ? rows.map(normalizeBranch) : [];
  }

  async delete(branchIdOrRef: string, opts: { force?: boolean } = {}): Promise<void> {
    const id = cleanName(branchIdOrRef);
    const force = opts.force === false ? '?force=false' : '';
    await this.request(`/v1/branches/${encodeURIComponent(id)}${force}`, { method: 'DELETE' });
  }

  async waitUntilReady(input: PollBranchInput): Promise<SupabaseBranch> {
    const timeoutMs = input.timeoutMs ?? 10 * 60_000;
    const intervalMs = input.intervalMs ?? 3_000;
    const started = Date.now();

    while (true) {
      const branch = await this.get(input.name);
      const status = readyStatus(branch);
      if (status && READY_STATUSES.has(status)) return branch;
      if (status && FAILED_STATUSES.has(status)) {
        throw new SupabaseBranchError(`Supabase branch ${branch.name} is not usable: ${status}.`);
      }
      if (Date.now() - started >= timeoutMs) {
        throw new SupabaseBranchError(`Timed out waiting for Supabase branch ${input.name} to become ready.`);
      }
      await sleep(intervalMs, input.signal);
    }
  }

  async withBranch<T>(input: CreateBranchInput, fn: (branch: SupabaseBranch) => Promise<T>): Promise<T> {
    const created = await this.create(input);
    const branchName = created.name || input.name;
    const branchRef = created.project_ref || created.id || branchName;
    try {
      const ready = await this.waitUntilReady({ name: branchName });
      return await fn(ready);
    } finally {
      await this.delete(branchRef, { force: true }).catch(() => undefined);
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    if (!res.ok) {
      throw new SupabaseBranchError(`Supabase Management API ${res.status}: ${redact(text).slice(0, 500)}`, res.status);
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}
