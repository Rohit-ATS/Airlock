import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseBranchClient, SupabaseBranchError } from '../dist/index.js';

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function client(fetch) {
  return new SupabaseBranchClient({
    projectRef: 'projabc123',
    accessToken: 'sbp_secret_token_for_tests',
    apiBaseUrl: 'https://api.supabase.test',
    fetch,
  });
}

test('creates an ephemeral data branch with the documented Management API shape', async () => {
  const calls = [];
  const c = client(async (url, init) => {
    calls.push({ url, init });
    return json({
      id: 'branch-id',
      name: 'airlock/dos_1',
      project_ref: 'branchref123',
      parent_project_ref: 'projabc123',
      status: 'CREATING_PROJECT',
      preview_project_status: 'STARTING',
      with_data: true,
      persistent: false,
    }, 201);
  });

  const branch = await c.create({ name: 'airlock/dos_1', gitBranch: 'demo/tier' });

  assert.equal(branch.project_ref, 'branchref123');
  assert.equal(calls[0].url, 'https://api.supabase.test/v1/projects/projabc123/branches');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sbp_secret_token_for_tests');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    branch_name: 'airlock/dos_1',
    with_data: true,
    persistent: false,
    git_branch: 'demo/tier',
  });
});

test('polls by branch name until Supabase reports the preview project healthy', async () => {
  const statuses = ['CREATING_PROJECT', 'ACTIVE_HEALTHY'];
  const c = client(async () =>
    json({
      id: 'branch-id',
      name: 'airlock/dos_2',
      project_ref: 'branchref456',
      parent_project_ref: 'projabc123',
      preview_project_status: statuses.shift(),
    }),
  );

  const branch = await c.waitUntilReady({ name: 'airlock/dos_2', intervalMs: 1, timeoutMs: 100 });

  assert.equal(branch.project_ref, 'branchref456');
  assert.equal(branch.preview_project_status, 'ACTIVE_HEALTHY');
});

test('tears a branch down even when the verifier callback fails', async () => {
  const calls = [];
  const c = client(async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (init.method === 'POST') {
      return json({ id: 'branch-id', name: 'airlock/dos_3', project_ref: 'branchref789' }, 201);
    }
    if ((init.method ?? 'GET') === 'GET') {
      return json({ id: 'branch-id', name: 'airlock/dos_3', project_ref: 'branchref789', status: 'ACTIVE_HEALTHY' });
    }
    return json({ message: 'ok' });
  });

  await assert.rejects(
    c.withBranch({ name: 'airlock/dos_3' }, async () => {
      throw new Error('verification failed');
    }),
    /verification failed/,
  );

  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'DELETE']);
  assert.equal(calls.at(-1).url, 'https://api.supabase.test/v1/branches/branchref789');
});

test('tears a branch down when Supabase reports the preview branch failed', async () => {
  const calls = [];
  const c = client(async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (init.method === 'POST') {
      return json({ id: 'branch-id', name: 'airlock/dos_4', project_ref: 'branchref999' }, 201);
    }
    if ((init.method ?? 'GET') === 'GET') {
      return json({ id: 'branch-id', name: 'airlock/dos_4', project_ref: 'branchref999', preview_project_status: 'failed' });
    }
    return json({ message: 'ok' });
  });

  await assert.rejects(c.withBranch({ name: 'airlock/dos_4' }, async () => undefined), /FAILED/);

  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'DELETE']);
  assert.equal(calls.at(-1).url, 'https://api.supabase.test/v1/branches/branchref999');
});

test('redacts Supabase tokens from Management API errors', async () => {
  const c = client(async () => ({
    ok: false,
    status: 403,
    text: async () => 'permission denied for Bearer sbp_secret_token_for_tests',
  }));

  await assert.rejects(c.list(), (error) => {
    assert.ok(error instanceof SupabaseBranchError);
    assert.equal(error.status, 403);
    assert.match(error.message, /Bearer \[redacted\]/);
    assert.doesNotMatch(error.message, /sbp_secret_token_for_tests/);
    return true;
  });
});
