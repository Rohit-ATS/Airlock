import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDossier } from '@airlock/contract';

process.env.AIRLOCK_CONSOLE_URL = 'http://console.test';
process.env.SUPABASE_URL = 'https://projabc123.supabase.co';
process.env.SUPABASE_ACCESS_TOKEN = 'sbp_test_token_that_must_not_leak';

const { airlockTools } = await import('../dist/index.js');

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function dossier() {
  return parseDossier({
    dossier_id: 'dos_free_tier_branching',
    change_class: 'SCHEMA_MIGRATION',
    request: 'add a nullable tier column to users',
    requested_by: 'damir@airlock.dev',
    started_by: 'ui',
    created_at: '2026-08-30T12:00:00Z',
    target: { systems: ['postgres'], branch_ref: 'shadow/dos_free_tier_branching' },
    forward: [{ system: 'postgres', op: 'alter table users add column tier text', reversible: true }],
    rollback: [{ system: 'postgres', op: 'alter table users drop column tier', reversible: true }],
    affected_tables: [{ system: 'postgres', name: 'users', rows: 0, operation: 'add column' }],
    risk_notes: [{ note: 'Existing note should survive verification.' }],
    recommendation: 'APPLY',
  });
}

test('verification falls back to Postgres shadow when Supabase branches are unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const saved = [];
  const queries = [];
  let digestCalls = 0;

  Date.now = () => 1788100000000;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';

    if (url === 'http://console.test/api/dossiers' && method === 'GET') {
      return response({ dossiers: [dossier()] });
    }

    if (url === 'http://console.test/api/dossiers' && method === 'POST') {
      const posted = JSON.parse(String(init.body));
      saved.push(posted);
      return response({ dossier: posted });
    }

    if (url === 'https://api.supabase.com/v1/projects/projabc123/branches' && method === 'POST') {
      return response({ message: 'Branching requires Pro for Bearer sbp_test_token_that_must_not_leak' }, 402);
    }

    if (url === 'https://api.supabase.com/v1/projects/projabc123/database/query' && method === 'POST') {
      const query = JSON.parse(String(init.body)).query;
      queries.push(query);
      if (query.includes('pg_class')) {
        const schema = query.includes("n.nspname = 'public'") ? 'public' : 'airlock_shadow';
        return response([{ table: 'users', relfilenode: schema === 'public' ? '10' : '20', indexes: [], constraints: [] }]);
      }
      if (query.includes('count(*)::int')) return response([{ n: 42 }]);
      if (query.includes('string_agg(t ||')) {
        digestCalls += 1;
        return response([{ digest: digestCalls === 2 ? HEX_B : HEX_A }]);
      }
      return response([]);
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  };

  try {
    const tool = airlockTools().find((t) => t.name === 'airlock_verify_change');
    assert.ok(tool, 'airlock_verify_change must exist');

    const text = await tool.handler({ dossier_id: 'dos_free_tier_branching', tables: ['users'] });

    assert.match(text, /PROVEN/);
    assert.match(text, /throwaway schema in your Postgres/);
    assert.equal(saved.length, 1);
    assert.match(saved[0].certificate.sandbox_artifact_url, /^pg-shadow:\/\/projabc123\/dos_free_tier_branching-/);
    assert.deepEqual(saved[0].certificate.checksums, {
      pre: `sha256:${HEX_A}`,
      post: `sha256:${HEX_B}`,
      post_rollback: `sha256:${HEX_A}`,
      match: true,
    });
    assert.equal(saved[0].affected_tables[0].rows, 42);
    assert.equal(saved[0].forward[0].proven, true);
    assert.equal(saved[0].rollback[0].proven, true);
    assert.ok(saved[0].risk_notes.some((note) => note.note.includes('throwaway schema')));
    assert.ok(saved[0].risk_notes.some((note) => note.note === 'Existing note should survive verification.'));
    assert.ok(queries.some((query) => query.includes('drop schema if exists')));
    assert.doesNotMatch(JSON.stringify(saved[0]), /sbp_test_token_that_must_not_leak/);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
