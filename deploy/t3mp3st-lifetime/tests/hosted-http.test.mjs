import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const appDir = resolve(process.env.T3MP3ST_TEST_APP_DIR || '/app');
const entry = join(appDir, 'dist/server.js');
const appAvailable = existsSync(entry);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't3mp3st-http-'));
  const stateDir = join(root, 'state');
  const configDir = join(root, 'config');
  await Promise.all([mkdir(stateDir), mkdir(configDir)]);
  const statusPath = join(stateDir, 'runtime-status.json');
  await writeFile(statusPath, JSON.stringify({ ready: true, readOnly: false }));
  const fields = ['missionDrafts', 'improvementProposals', 'approvalRequests', 'evidenceLedger', 'findingsLedger', 'retestLedger', 'hypothesisLedger', 'workOrderLedger', 'watchCycleLedger', 'memoryCapsule', 'memoryProposals'];
  await writeFile(join(stateDir, 'state.json'), JSON.stringify({
    schema_version: 't3mp3st_state/v1',
    ...Object.fromEntries(fields.map(name => [name, []])),
    compatiblePreferences: { dashboard: 'audit' },
  }));
  await writeFile(join(stateDir, 'events.jsonl'), JSON.stringify({ ts: '2026-10-07T00:00:00Z', type: 'fixture.restored', payload: {} }) + '\n');
  return { root, stateDir, configDir, statusPath, port: await unusedPort() };
}

function launch(item) {
  return spawn(process.execPath, [entry], {
    cwd: appDir, stdio: 'ignore',
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: item.root, NODE_ENV: 'test', T3MP3ST_HOSTED: 'true',
      T3MP3ST_HOST: '127.0.0.1', T3MP3ST_PORT: String(item.port),
      T3MP3ST_STATE_DIR: item.stateDir, T3MP3ST_CONFIG_DIR: item.configDir,
      TEMPEST_DEFAULT_PROVIDER: 'openai',
    },
  });
}

async function request(item, path, { method = 'GET', headers = {}, value, raw } = {}) {
  const body = raw !== undefined ? raw : value !== undefined ? JSON.stringify(value) : undefined;
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: item.port, path, method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP test request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function ready(item, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error('Test server exited before readiness');
    try { if ((await request(item, '/api/health')).status === 200) return; } catch {}
    await pause(100);
  }
  throw new Error('Test server readiness timed out');
}

async function close(child, signal) {
  const done = once(child, 'close');
  child.kill(signal);
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try { return await done; } finally { clearTimeout(timer); }
}

test('actual hosted HTTP rejects unsafe requests and both signals flush pending state', { skip: !appAvailable, timeout: 60000 }, async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const item = await fixture();
    const child = launch(item);
    try {
      await ready(item, child);
      assert.equal((await request(item, '/api/health', { headers: { origin: 'https://foreign.example' } })).status, 403);
      assert.equal((await request(item, '/api/health', { headers: { host: 'foreign.example' } })).status, 403);
      assert.ok([403, 404].includes((await request(item, '/API/LLM/STATUS')).status));
      assert.equal((await request(item, '/api/agents/local/status')).status, 403);
      assert.equal((await request(item, '/api/models', { method: 'POST', value: { provider: 'openai', baseUrl: 'http://169.254.169.254' } })).status, 403);
      assert.equal((await request(item, '/api/tools/execute', { method: 'POST', value: { command: 'curl http://169.254.169.254' } })).status, 403);
      assert.equal((await request(item, '/api/llm/chat', { method: 'POST', value: { message: [] } })).status, 403);
      assert.equal((await request(item, '/api/llm/chat', { method: 'POST', raw: '{broken' })).status, 400);
      assert.equal((await request(item, '/api/llm/chat', { method: 'POST', raw: JSON.stringify({ message: 'x'.repeat(1050000) }) })).status, 413);
      await writeFile(item.statusPath, JSON.stringify({ ready: true, readOnly: true }));
      assert.equal((await request(item, '/api/memory/proposals', { method: 'POST', value: { type: 'open_question', content: 'Must not mutate read-only state' } })).status, 503);
      assert.equal((await request(item, '/api/runtime/status')).status, 503);
      await writeFile(item.statusPath, JSON.stringify({ ready: true, readOnly: false }));
      const marker = 'HTTP shutdown durability ' + signal;
      const created = await request(item, '/api/memory/proposals', { method: 'POST', value: { type: 'open_question', content: marker } });
      assert.equal(created.status, 201);
      const proposal = await created.json();
      assert.equal(typeof proposal.id, 'string');
      // Immediately terminate, before the one-second debounce normally writes.
      const [code, observedSignal] = await close(child, signal);
      assert.equal(code, 0);
      assert.equal(observedSignal, null);
      const state = JSON.parse(await readFile(join(item.stateDir, 'state.json'), 'utf8'));
      assert.ok(state.memoryProposals.some(row => row.id === proposal.id && row.content === marker));
      assert.deepEqual(state.compatiblePreferences, { dashboard: 'audit' });
      const events = (await readFile(join(item.stateDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.ok(events.some(row => row.type === 'fixture.restored'));
      assert.ok(events.some(row => row.type === 'memory.proposed' && row.payload.proposalId === proposal.id));
    } finally {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
      await rm(item.root, { recursive: true, force: true });
    }
  }
});

test('actual hosted startup rejects corrupt local state rather than resetting ledgers', { skip: !appAvailable, timeout: 25000 }, async () => {
  const item = await fixture();
  await writeFile(join(item.stateDir, 'state.json'), '{"schema_version":"wrong"}');
  const child = launch(item);
  try {
    const [code, signal] = await closeAfterNaturalExit(child);
    assert.equal(signal, null);
    assert.ok(Number.isInteger(code) && code !== 0);
    assert.equal(await readFile(join(item.stateDir, 'state.json'), 'utf8'), '{"schema_version":"wrong"}');
  } finally {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
    await rm(item.root, { recursive: true, force: true });
  }
});

async function closeAfterNaturalExit(child) {
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  try { return await once(child, 'close'); } finally { clearTimeout(timer); }
}
