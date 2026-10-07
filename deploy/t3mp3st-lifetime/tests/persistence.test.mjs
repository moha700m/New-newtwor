import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SNAPSHOT_FILES,
  MAX_SNAPSHOT_BYTES,
  buildSnapshotFileMap,
  installSnapshotBundle,
  sha256,
  validateSnapshotBytes,
} from '../persistence-files.mjs';
import { PersistenceError, SnapshotPersistence, createBlobAdapter, isTransientStorageError, isTypedMissingBlobError } from '../persistence-store.mjs';
import { buildChildEnvironment, buildRuntimeConfig, resolveOpenAIModel, writerEpochFromEnvironment } from '../runtime-config.mjs';
import { createRuntimeStatus, createRuntimeStatusQueue, RUNTIME_STATUS_SCHEMA, setPersistenceStatus, setStatusError, writeRuntimeStatus } from '../runtime-status.mjs';
import { shutdownChildAndFlush } from '../supervisor-lifecycle.mjs';
import { performLlmSmoke, runSupervisor } from '../vercel-blob-state.mjs';

const LEGACY = ['state/state.json', 'state/events.jsonl', 'config/config.json', 'meta/runtime.json'];
const OPENAI_FIXTURE_SECRET = ['fixture', 'openai', 'credential'].join('_');
const OTHER_FIXTURE_SECRET = ['fixture', 'secondary', 'credential'].join('_');

function stateFixture(note = 'unchanged') {
  return {
    schema_version: 't3mp3st_state/v1',
    savedAt: new Date(0).toISOString(),
    note,
    missionDrafts: [],
    improvementProposals: [],
    approvalRequests: [],
    evidenceLedger: [],
    findingsLedger: [],
    retestLedger: [],
    hypothesisLedger: [],
    workOrderLedger: [],
    watchCycleLedger: [],
    memoryCapsule: [],
    memoryProposals: [],
  };
}

function configFixture(overrides = {}) {
  return {
    apiKeys: {},
    defaultProvider: 'openai',
    defaultModel: 'gpt-6.1-sol',
    openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-6.1-sol' },
    maxTokens: 1024,
    timeout: 30_000,
    ...overrides,
  };
}

class ConflictError extends Error {
  constructor() { super('conditional write conflict'); this.name = 'BlobPreconditionFailedError'; this.status = 412; }
}

class MemoryBlobStore {
  constructor() {
    this.objects = new Map();
    this.etagCounter = 0;
    this.puts = [];
    this.gets = [];
    this.verifyCalls = [];
    this.beforePut = null;
    this.concurrentManifestPuts = 0;
    this.maxConcurrentManifestPuts = 0;
  }

  async get(key) {
    this.gets.push(key);
    const item = this.objects.get(key);
    return item ? { bytes: Buffer.from(item.bytes), etag: item.etag, url: item.url } : null;
  }

  async put(key, bytes, options = {}) {
    const record = { key, options: structuredClone(options), bytes: Buffer.from(bytes) };
    this.puts.push(record);
    const isManifest = key.endsWith('/v2/manifest.json');
    if (isManifest) {
      this.concurrentManifestPuts += 1;
      this.maxConcurrentManifestPuts = Math.max(this.maxConcurrentManifestPuts, this.concurrentManifestPuts);
    }
    try {
      if (this.beforePut) await this.beforePut(record, this);
      const existing = this.objects.get(key);
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new ConflictError();
      if (options.allowOverwrite === false && existing) throw new ConflictError();
      if (existing && !options.ifMatch && options.allowOverwrite !== true && options.allowOverwrite !== false) throw new ConflictError();
      const etag = `etag-${++this.etagCounter}`;
      const url = `https://private.blob.test/${encodeURIComponent(key)}`;
      this.objects.set(key, { bytes: Buffer.from(bytes), etag, url });
      return { etag, url };
    } finally {
      if (isManifest) this.concurrentManifestPuts -= 1;
    }
  }

  async verifyPrivateRead(url) {
    this.verifyCalls.push(url);
    return { denied: true, status: 403 };
  }
}

async function fixture({ prefix = 'test-runtime', epoch = 0, ownerId = `owner-${Math.random()}`, store = new MemoryBlobStore(), environment = {}, now, onStatus, readOnly = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 't3mp3st-persist-test-'));
  const stateDir = join(root, 'state');
  const configDir = join(root, 'config');
  await mkdir(stateDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  const files = buildSnapshotFileMap(stateDir, configDir);
  const manager = new SnapshotPersistence({
    adapter: store,
    prefix,
    fileMap: files,
    ownerId,
    epoch,
    leaseMs: 30_000,
    environment,
    now,
    onStatus,
    readOnly,
    sleep: async () => {},
  });
  return { root, stateDir, configDir, files, manager, store };
}

async function seedLocalFiles(item, { state = stateFixture(), events = '{"ts":"1970-01-01T00:00:00.000Z","type":"ready","payload":{}}\n', config = configFixture() } = {}) {
  await mkdir(join(item.stateDir, 'nested'), { recursive: true });
  await mkdir(item.configDir, { recursive: true });
  await writeFile(item.files['state/state.json'], JSON.stringify(state));
  await writeFile(item.files['state/events.jsonl'], events);
  await writeFile(item.files['config/config.json'], JSON.stringify(config));
}

async function restoredAndClaimed(item) {
  await item.manager.restore();
  const claimed = await item.manager.claim();
  assert.equal(claimed, true);
  return claimed;
}

function readManifest(store, prefix = 'test-runtime') {
  return store.get(`${prefix}/v2/manifest.json`).then(result => JSON.parse(result.bytes.toString('utf8')));
}

function fakeBlobSdk(objects) {
  let etagIndex = 0;
  return {
    async get(key) {
      const item = objects.get(key);
      return item ? { blob: { etag: item.etag, url: item.url }, stream: new Response(item.bytes).body } : null;
    },
    async put(key, bytes, options = {}) {
      const existing = objects.get(key);
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new ConflictError();
      if (options.allowOverwrite === false && existing) throw new ConflictError();
      const etag = `sdk-etag-${++etagIndex}`;
      const url = `https://private.blob.test/${encodeURIComponent(key)}`;
      objects.set(key, { bytes: Buffer.from(bytes), etag, url });
      return { etag, url };
    },
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => {
    child.signalCode = signal;
    setImmediate(() => child.emit('close', null, signal));
    return true;
  };
  return child;
}

test('publishes scrubbed content-addressed snapshots before a manifest CAS and never writes v1 or .env', async t => {
  const item = await fixture({ environment: { OPENAI_API_KEY: OPENAI_FIXTURE_SECRET, T3MP3ST_MAX_TOKENS: '1024' } });
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await seedLocalFiles(item, {
    state: { ...stateFixture(), findingsLedger: [{ id: 'f1', details: `key=${OPENAI_FIXTURE_SECRET}; maxTokens=1024` }, { id: '1024', details: 'preserve the configured limit 1024' }] },
    config: configFixture({ apiKeys: { openai: OPENAI_FIXTURE_SECRET, nested: { token: 'leak' } } }),
  });
  await writeFile(join(item.configDir, '.env'), 'OPENAI_API_KEY=local-env-is-ignored\n');
  await restoredAndClaimed(item);

  const manifest = await readManifest(item.store);
  assert.equal(manifest.schema_version, 't3mp3st_blob_state/v2');
  assert.equal(manifest.revision, 1);
  assert.equal(manifest.writer.owner, item.manager.ownerId);
  assert.equal(manifest.writer.epoch, 0);
  for (const ref of Object.values(manifest.files)) {
    assert.equal(ref.sha256, ref.object.split('/').at(-1));
    assert.ok(ref.object.startsWith('test-runtime/v2/snapshots/sha256/'));
  }
  const objectWrites = item.store.puts.filter(put => put.key.includes('/snapshots/'));
  assert.equal(objectWrites.length, SNAPSHOT_FILES.length);
  assert.ok(objectWrites.every(put => put.options.allowOverwrite === false && !put.options.ifMatch));
  assert.ok(objectWrites.every(put => put.options.addRandomSuffix === false));
  const headWrite = item.store.puts.find(put => put.key.endsWith('/v2/manifest.json'));
  assert.equal(headWrite.options.allowOverwrite, false);
  assert.equal(headWrite.options.addRandomSuffix, false);
  assert.equal(headWrite.options.ifMatch, undefined);
  assert.ok(item.store.puts.indexOf(headWrite) > Math.max(...objectWrites.map(put => item.store.puts.indexOf(put))));
  assert.ok(item.store.verifyCalls.length > 0);
  assert.ok(item.store.verifyCalls[0].startsWith('https://private.blob.test/'));
  assert.deepEqual(manifest.legacyDigests, Object.fromEntries(LEGACY.map(key => [key, null])));
  assert.ok(item.store.puts.every(put => !put.key.includes('.env')));
  assert.ok(item.store.gets.some(key => key === 't3mp3st-runtime/v1/config/config.json'));
  assert.ok(item.store.gets.some(key => key === 't3mp3st-runtime/v1/meta/runtime.json'));
  assert.ok(!item.store.gets.some(key => key.includes('.env')));

  const savedState = item.store.objects.get(manifest.files['state/state.json'].object).bytes.toString('utf8');
  const savedConfig = item.store.objects.get(manifest.files['config/config.json'].object).bytes.toString('utf8');
  assert.ok(!savedState.includes(OPENAI_FIXTURE_SECRET));
  assert.ok(savedState.includes('[REDACTED]'));
  assert.ok(savedState.includes('"id": "1024"'));
  assert.ok(savedState.includes('limit 1024'));
  assert.ok(!savedConfig.includes('apiKeys'));
  assert.ok(!savedConfig.includes(OPENAI_FIXTURE_SECRET));
  assert.ok(!savedConfig.includes('local-env-is-ignored'));
});

test('restores only after the whole snapshot bundle passes digest and schema validation', async t => {
  const source = await fixture();
  t.after(() => rm(source.root, { recursive: true, force: true }));
  await seedLocalFiles(source);
  await restoredAndClaimed(source);
  const manifest = await readManifest(source.store);
  const eventRef = manifest.files['state/events.jsonl'];
  source.store.objects.get(eventRef.object).bytes = Buffer.from('{"corrupt":true}\n');

  const target = await fixture({ store: source.store, prefix: 'test-runtime' });
  t.after(() => rm(target.root, { recursive: true, force: true }));
  await writeFile(target.files['state/state.json'], JSON.stringify(stateFixture('local-sentinel')));
  await assert.rejects(target.manager.restore(), error => error.category === 'snapshot_integrity_failed');
  const unchanged = JSON.parse(await readFile(target.files['state/state.json'], 'utf8'));
  assert.equal(unchanged.note, 'local-sentinel');
});

test('rejects a digest-valid state object with the wrong schema before installing it', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const invalid = Buffer.from(JSON.stringify({ schema_version: 'other/v1', memoryCapsule: [] }));
  const digest = sha256(invalid);
  const key = `test-runtime/v2/snapshots/sha256/${digest}`;
  await item.store.put(key, invalid, { allowOverwrite: false });
  const manifest = {
    schema_version: 't3mp3st_blob_state/v2', revision: 1, parentRevision: null,
    updatedAt: new Date().toISOString(),
    files: { 'state/state.json': { sha256: digest, bytes: invalid.length, object: key, contentType: 'application/json' } },
    writer: { owner: 'old-writer', epoch: 0, leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() },
    legacyDigests: Object.fromEntries(LEGACY.map(name => [name, null])),
  };
  await item.store.put('test-runtime/v2/manifest.json', Buffer.from(JSON.stringify(manifest)), { allowOverwrite: false });
  await assert.rejects(item.manager.restore(), error => error.category === 'invalid_state_schema');
  await assert.rejects(readFile(item.files['state/state.json']), error => error.code === 'ENOENT');
});

test('legacy v1 config is read-only, scrubbed, merged for benign settings, then rechecked by digest', async t => {
  const store = new MemoryBlobStore();
  const item = await fixture({ store, environment: { OPENAI_API_KEY: OPENAI_FIXTURE_SECRET } });
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const legacyConfig = Buffer.from(JSON.stringify({
    apiKeys: { openai: OPENAI_FIXTURE_SECRET, github_token: OTHER_FIXTURE_SECRET },
    defaultProvider: 'openrouter',
    defaultModel: 'legacy-model',
    openai: { baseUrl: 'https://attacker.invalid/v1', defaultModel: 'legacy-model', siteName: 'Saved preference' },
    temperature: 0.35,
    ui: { colorOutput: false, showBanner: false },
    proxyUrl: 'socks5://operator:secret@proxy.invalid:1080',
    compatibleExtension: { enabled: true },
  }));
  store.objects.set('t3mp3st-runtime/v1/config/config.json', {
    bytes: legacyConfig, etag: 'legacy-config-etag', url: 'https://private.blob.test/legacy-config',
  });
  store.objects.set('t3mp3st-runtime/v1/meta/runtime.json', {
    bytes: Buffer.from('{"bootCount":4}'), etag: 'legacy-meta-etag', url: 'https://private.blob.test/legacy-meta',
  });

  const restore = await item.manager.restore();
  assert.equal(restore.legacyDigests['config/config.json'], sha256(legacyConfig));
  assert.equal(restore.legacyDigests['meta/runtime.json'], sha256(Buffer.from('{"bootCount":4}')));
  const sanitized = JSON.parse(await readFile(item.files['config/config.json'], 'utf8'));
  assert.equal(sanitized.ui.colorOutput, false);
  assert.equal(sanitized.compatibleExtension.enabled, true);
  assert.equal(sanitized.openai.siteName, 'Saved preference');
  assert.equal('apiKeys' in sanitized, false);
  assert.ok(!JSON.stringify(sanitized).includes(OPENAI_FIXTURE_SECRET));
  assert.ok(!JSON.stringify(sanitized).includes(OTHER_FIXTURE_SECRET));

  const runtime = buildRuntimeConfig({ model: 'gpt-6.1-sol' }, {}, sanitized);
  assert.equal(runtime.defaultProvider, 'openai');
  assert.equal(runtime.defaultModel, 'gpt-6.1-sol');
  assert.equal(runtime.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(runtime.openai.siteName, 'Saved preference');
  assert.deepEqual(runtime.apiKeys, {});
  assert.equal(runtime.maxTokens, 1024);
  assert.equal(runtime.timeout, 30_000);
  assert.equal(runtime.temperature, 0.35);
  assert.equal(runtime.proxyUrl, '');
  assert.deepEqual(runtime.fallbackChain, []);
  assert.equal(runtime.compatibleExtension.enabled, true);

  assert.equal((await item.manager.recheckLegacy()).unchanged, true);
  const changed = Buffer.from(JSON.stringify({ defaultProvider: 'openai', ui: { colorOutput: true } }));
  store.objects.set('t3mp3st-runtime/v1/config/config.json', {
    bytes: changed, etag: 'legacy-config-etag-2', url: 'https://private.blob.test/legacy-config',
  });
  const recheck = await item.manager.recheckLegacy();
  assert.equal(recheck.unchanged, false);
  assert.equal(recheck.digests['config/config.json'], sha256(changed));
  assert.ok(store.puts.every(put => !put.key.startsWith('t3mp3st-runtime/v1/')));
});

test('rejects state records without IDs and JSONL rows without the upstream event fields', () => {
  const noId = Buffer.from(JSON.stringify({ ...stateFixture(), findingsLedger: [{ details: 'upstream would ignore this' }] }));
  assert.throws(() => validateSnapshotBytes('state', noId), error => error.category === 'invalid_state_schema');
  assert.throws(() => validateSnapshotBytes('events', Buffer.from('{"type":"ready","payload":{}}\n')),
    error => error.category === 'invalid_events_jsonl');
  assert.throws(() => validateSnapshotBytes('events', Buffer.from('{"ts":"2026-01-01T00:00:00.000Z","type":"ready","payload":[]}\n')),
    error => error.category === 'invalid_events_jsonl');
  const duplicateIds = Buffer.from(JSON.stringify({ ...stateFixture(), findingsLedger: [{ id: 'same' }, { id: 'same' }] }));
  assert.throws(() => validateSnapshotBytes('state', duplicateIds), error => error.category === 'invalid_state_schema');
  assert.throws(() => validateSnapshotBytes('events', Buffer.alloc(MAX_SNAPSHOT_BYTES + 1)), error => error.category === 'snapshot_too_large');
});

test('typed Blob not-found is missing while generic 404-like errors remain failures', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  class BlobNotFoundError extends Error { constructor() { super('missing'); this.name = 'Error'; } }
  class BlobServiceNotAvailable extends Error { constructor() { super('service unavailable'); this.name = 'Error'; } }
  assert.equal(isTypedMissingBlobError(new BlobNotFoundError()), true);
  assert.equal(isTransientStorageError(new BlobServiceNotAvailable()), true);
  const original = item.store.get.bind(item.store);
  item.store.get = async key => {
    if (key === 'typed-missing') throw new BlobNotFoundError();
    if (key === 'generic-missing') throw Object.assign(new Error('404 not found'), { status: 404 });
    return original(key);
  };
  assert.equal(await item.manager.readBlob('typed-missing'), null);
  await assert.rejects(item.manager.readBlob('generic-missing'), error => error.category === 'storage_operation_failed');
});

test('failed anonymous privacy checks are retried and never cached as denied', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  let calls = 0;
  item.store.verifyPrivateRead = async () => {
    calls += 1;
    return calls === 1 ? { denied: false, status: 503 } : { denied: true, status: 403 };
  };
  await item.manager.verifyPrivateSnapshotUrl('https://private.blob.test/snapshot');
  assert.equal(calls, 2);
  assert.deepEqual(item.manager.privateReadCheck.denied, true);
  assert.deepEqual(item.manager.privateReadCheck.checked, true);

  const failing = await fixture({ store: item.store });
  t.after(() => rm(failing.root, { recursive: true, force: true }));
  item.store.verifyPrivateRead = async () => ({ denied: false, status: null, errorCategory: 'timeout' });
  await assert.rejects(failing.manager.verifyPrivateSnapshotUrl('https://private.blob.test/snapshot'), error => error.category === 'private_read_check_failed');
  assert.equal(failing.manager.privateReadCheck.checked, false);
  item.store.verifyPrivateRead = async () => ({ denied: true, status: 404 });
  await failing.manager.verifyPrivateSnapshotUrl('https://private.blob.test/snapshot');
  assert.equal(failing.manager.privateReadCheck.denied, true);
});

test('retries transient reads three times but does not interpret permission errors as missing', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const originalGet = item.store.get.bind(item.store);
  let transientCalls = 0;
  item.store.get = async key => {
    if (key === 'transient' && transientCalls < 2) { transientCalls += 1; throw Object.assign(new Error('temporary'), { status: 503 }); }
    if (key === 'forbidden') throw Object.assign(new Error('denied'), { status: 403 });
    return originalGet(key);
  };
  assert.equal(await item.manager.readBlob('transient'), null);
  assert.equal(transientCalls, 2);
  await assert.rejects(item.manager.readBlob('forbidden'), error => error.category === 'storage_operation_failed');
});

test('partial snapshot upload leaves the previous manifest head committed', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await seedLocalFiles(item);
  await restoredAndClaimed(item);
  const before = await readManifest(item.store);
  let failures = 0;
  item.store.beforePut = async record => {
    if (record.key.includes('/snapshots/') && failures < 3) {
      failures += 1;
      throw Object.assign(new Error('temporary upload failure'), { status: 503 });
    }
  };
  await writeFile(item.files['state/state.json'], JSON.stringify(stateFixture('updated')));
  await assert.rejects(item.manager.sync(), error => error.category === 'storage_unavailable');
  const after = await readManifest(item.store);
  assert.deepEqual(after, before);
  assert.equal(failures, 3);
  assert.equal(item.manager.revision, before.revision);
});

test('a concurrent first-head winner fences the loser without a second unconditional create', async t => {
  const store = new MemoryBlobStore();
  const first = await fixture({ store, ownerId: 'winner' });
  const second = await fixture({ store, ownerId: 'loser' });
  t.after(async () => { await rm(first.root, { recursive: true, force: true }); await rm(second.root, { recursive: true, force: true }); });
  await seedLocalFiles(first);
  await seedLocalFiles(second);
  await first.manager.restore();
  await second.manager.restore();
  assert.equal(await first.manager.claim(), true);
  assert.equal(await second.manager.claim(), false);
  assert.equal(second.manager.readOnly, true);
  const manifestWrites = store.puts.filter(put => put.key.endsWith('/v2/manifest.json'));
  assert.equal(manifestWrites.length, 2);
  assert.ok(manifestWrites.every(put => put.options.allowOverwrite === false));
  const head = await readManifest(store);
  assert.equal(head.writer.owner, 'winner');
  assert.equal(head.revision, 1);
});

test('a lower epoch cannot take an expired higher-epoch lease in a first-head race', async t => {
  const store = new MemoryBlobStore();
  const low = await fixture({ store, ownerId: 'low-epoch-writer', epoch: 0 });
  const high = await fixture({ store, ownerId: 'high-epoch-writer', epoch: 10 });
  t.after(async () => { await rm(low.root, { recursive: true, force: true }); await rm(high.root, { recursive: true, force: true }); });
  await seedLocalFiles(low);
  await seedLocalFiles(high);
  await low.manager.restore();
  await restoredAndClaimed(high);
  const head = store.objects.get('test-runtime/v2/manifest.json');
  const manifest = JSON.parse(head.bytes.toString('utf8'));
  manifest.writer.leaseExpiresAt = new Date(0).toISOString();
  head.bytes = Buffer.from(JSON.stringify(manifest));
  assert.equal(await low.manager.claim(), false);
  assert.equal(low.manager.readOnly, true);
  const after = await readManifest(store);
  assert.equal(after.writer.owner, 'high-epoch-writer');
  assert.equal(after.writer.epoch, 10);
  assert.equal(after.revision, 1);
});

test('same-epoch takeover observes a two-second expiry grace period', async t => {
  const store = new MemoryBlobStore();
  const owner = await fixture({ store, ownerId: 'owner', epoch: 0, now: () => 1_000 });
  const early = await fixture({ store, ownerId: 'early', epoch: 0, now: () => 32_000 });
  const ready = await fixture({ store, ownerId: 'ready', epoch: 0, now: () => 33_000 });
  t.after(async () => {
    await rm(owner.root, { recursive: true, force: true });
    await rm(early.root, { recursive: true, force: true });
    await rm(ready.root, { recursive: true, force: true });
  });
  await seedLocalFiles(owner);
  await seedLocalFiles(early);
  await seedLocalFiles(ready);
  await restoredAndClaimed(owner);
  const initial = await readManifest(store);
  assert.equal(Date.parse(initial.writer.leaseExpiresAt), 31_000);
  await early.manager.restore();
  assert.equal(await early.manager.claim(), false);
  assert.equal((await readManifest(store)).writer.owner, 'owner');
  await ready.manager.restore();
  assert.equal(await ready.manager.claim(), true);
  const taken = await readManifest(store);
  assert.equal(taken.writer.owner, 'ready');
  assert.equal(taken.revision, 2);
});

test('legacy changes between restore and initial migration fence writes', async t => {
  const store = new MemoryBlobStore();
  const item = await fixture({ store });
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const initial = Buffer.from(JSON.stringify(configFixture({ ui: { colorOutput: false } })));
  store.objects.set('t3mp3st-runtime/v1/config/config.json', { bytes: initial, etag: 'legacy-1', url: 'https://private.blob.test/legacy' });
  await item.manager.restore();
  const changed = Buffer.from(JSON.stringify(configFixture({ ui: { colorOutput: true } })));
  store.objects.set('t3mp3st-runtime/v1/config/config.json', { bytes: changed, etag: 'legacy-2', url: 'https://private.blob.test/legacy' });
  assert.equal((await item.manager.recheckLegacy()).unchanged, false);
  assert.equal(await item.manager.claim(), false);
  assert.equal(item.manager.readOnly, true);
  assert.equal(store.puts.length, 0);
});

test('explicit read-only mode restores state but cannot claim, publish, or release', async t => {
  const store = new MemoryBlobStore();
  const item = await fixture({ store, readOnly: true });
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await seedLocalFiles(item);
  for (const descriptor of SNAPSHOT_FILES) {
    const bytes = await readFile(item.files[descriptor.name]);
    store.objects.set(`t3mp3st-runtime/v1/${descriptor.name}`, {
      bytes, etag: `legacy-${descriptor.name}`, url: `https://private.blob.test/${descriptor.name}`,
    });
  }
  const restored = await item.manager.restore();
  assert.equal(restored.restoredFiles.length, SNAPSHOT_FILES.length);
  assert.equal(await item.manager.claim(), false);
  assert.equal(await item.manager.sync(), false);
  assert.equal(await item.manager.flush(), false);
  assert.equal(await item.manager.releaseLease(), false);
  assert.equal(store.puts.length, 0);
});

test('a dynamically fenced writer fails shutdown if local acknowledged state is not at the committed head', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await seedLocalFiles(item, { state: stateFixture('committed') });
  await restoredAndClaimed(item);
  await writeFile(item.files['state/state.json'], JSON.stringify(stateFixture('uncommitted')));
  item.manager.readOnly = true;
  const result = await shutdownChildAndFlush({
    child: null,
    flush: () => item.manager.flush(),
    releaseLease: () => item.manager.releaseLease(),
  });
  assert.equal(result.successful, false);
  assert.equal(result.flushError.category, 'writer_read_only');
  const head = await readManifest(item.store);
  const committed = item.store.objects.get(head.files['state/state.json'].object).bytes;
  assert.equal(JSON.parse(committed.toString('utf8')).note, 'committed');
});

test('higher epoch takes the lease by CAS and fences a stale writer', async t => {
  const store = new MemoryBlobStore();
  const old = await fixture({ store, ownerId: 'old', epoch: 0 });
  const current = await fixture({ store, ownerId: 'new', epoch: 1 });
  t.after(async () => { await rm(old.root, { recursive: true, force: true }); await rm(current.root, { recursive: true, force: true }); });
  await seedLocalFiles(old);
  await seedLocalFiles(current);
  await restoredAndClaimed(old);
  await current.manager.restore();
  assert.equal(await current.manager.claim(), true);
  const takeover = await readManifest(store);
  assert.equal(takeover.writer.owner, 'new');
  assert.equal(takeover.writer.epoch, 1);
  const oldRevision = old.manager.revision;
  await writeFile(old.files['state/state.json'], JSON.stringify(stateFixture('stale-write')));
  await assert.rejects(old.manager.sync(), error => error.category === 'writer_fenced');
  assert.equal(old.manager.readOnly, true);
  assert.equal(old.manager.revision, oldRevision);
  const after = await readManifest(store);
  assert.equal(after.writer.owner, 'new');
  assert.equal(after.revision, takeover.revision);
});

test('existing-head claim conflict refreshes ownership evidence without overwriting the winner', async t => {
  const store = new MemoryBlobStore();
  const original = await fixture({ store, epoch: 1, ownerId: 'original' });
  const candidate = await fixture({ store, epoch: 2, ownerId: 'candidate' });
  const winner = await fixture({ store, epoch: 3, ownerId: 'winner' });
  t.after(async () => {
    for (const item of [original, candidate, winner]) await rm(item.root, { recursive: true, force: true });
  });
  await seedLocalFiles(original);
  await restoredAndClaimed(original);
  await candidate.manager.restore();
  await winner.manager.restore();
  assert.equal(await winner.manager.claim(), true);
  const head = await readManifest(store);
  assert.equal(await candidate.manager.claim(), false);
  assert.equal(candidate.manager.readOnly, true);
  assert.equal(candidate.manager.revision, head.revision);
  assert.deepEqual(candidate.manager.claimStatus, {
    category: 'writer_conflict', attemptedEpoch: 2, currentEpoch: 3,
    revision: head.revision, ownerMatches: false,
  });
  assert.deepEqual(await readManifest(store), head);
});

test('overlapping syncs serialize and a write during upload is published on the next pass', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await seedLocalFiles(item);
  await restoredAndClaimed(item);
  let unblock;
  const blocked = new Promise(resolve => { unblock = resolve; });
  let entered;
  const enteredPut = new Promise(resolve => { entered = resolve; });
  let blockNextSnapshot = true;
  item.store.beforePut = async record => {
    if (blockNextSnapshot && record.key.includes('/snapshots/')) {
      blockNextSnapshot = false;
      entered();
      await blocked;
    }
  };
  const firstState = stateFixture('during-upload-a');
  const secondState = stateFixture('during-upload-b');
  await writeFile(item.files['state/state.json'], JSON.stringify(firstState));
  const firstSync = item.manager.sync();
  await enteredPut;
  await writeFile(item.files['state/state.json'], JSON.stringify(secondState));
  const secondSync = item.manager.sync();
  unblock();
  await Promise.all([firstSync, secondSync]);
  const manifest = await readManifest(item.store);
  const finalBytes = item.store.objects.get(manifest.files['state/state.json'].object).bytes;
  assert.equal(JSON.parse(finalBytes.toString('utf8')).note, 'during-upload-b');
  assert.equal(item.store.maxConcurrentManifestPuts, 1);
});

test('local bundle validation happens before any atomic file install', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const statePath = item.files['state/state.json'];
  await writeFile(statePath, JSON.stringify(stateFixture('keep-me')));
  const invalidEvents = Buffer.from('{not json}\n');
  await assert.rejects(installSnapshotBundle(new Map([
    ['state/state.json', { bytes: Buffer.from(JSON.stringify(stateFixture('replace-me'))) }],
    ['state/events.jsonl', { bytes: invalidEvents }],
  ]), item.files));
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).note, 'keep-me');
});

test('OpenAI runtime model selection fails closed and uses only an opted-in exact list', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-4o-mini' }] }), { status: 200 });
  };
  const base = { OPENAI_API_KEY: OPENAI_FIXTURE_SECRET };
  const missing = await resolveOpenAIModel({ environment: base, fetchImpl, now: () => 0 });
  assert.equal(missing.ready, false);
  assert.equal(missing.model, 'gpt-6.1-sol');
  assert.equal(missing.error, 'preferred_model_unavailable');
  assert.equal(request.url, 'https://api.openai.com/v1/models');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal);

  const fallback = await resolveOpenAIModel({
    environment: { ...base, T3MP3ST_OPENAI_ALLOW_FALLBACK: 'true', T3MP3ST_OPENAI_FALLBACK_MODELS: 'gpt-6-luna, gpt-4o-mini' },
    fetchImpl,
  });
  assert.equal(fallback.ready, true);
  assert.equal(fallback.model, 'gpt-6-luna');
  assert.equal(fallback.fallbackUsed, true);
  const disabled = await resolveOpenAIModel({
    environment: { ...base, T3MP3ST_OPENAI_FALLBACK_MODELS: 'gpt-6-luna' },
    fetchImpl,
  });
  assert.equal(disabled.ready, false);
  assert.equal(disabled.model, 'gpt-6.1-sol');
});

test('generated config and child environment contain only bounded OpenAI runtime settings', () => {
  const config = buildRuntimeConfig({ model: 'gpt-6.1-sol' }, { T3MP3ST_MAX_TOKENS: '2048' }, {
    apiKeys: { anthropic: 'old-secret' },
    temperature: 0.4,
    ui: { colorOutput: false },
    proxyUrl: 'socks5://old-proxy',
    fallbackChain: [{ provider: 'anthropic', model: 'other' }],
  });
  assert.deepEqual(config.apiKeys, {});
  assert.equal(config.defaultProvider, 'openai');
  assert.equal(config.defaultModel, 'gpt-6.1-sol');
  assert.equal(config.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(config.maxTokens, 1024);
  assert.equal(config.timeout, 30_000);
  assert.equal(config.temperature, 0.4);
  assert.equal(config.ui.colorOutput, false);
  assert.equal(config.proxyUrl, '');
  assert.deepEqual(config.fallbackChain, []);
  const env = buildChildEnvironment({
    PATH: '/usr/bin', HOME: '/root', OPENAI_API_KEY: OPENAI_FIXTURE_SECRET,
    BLOB_READ_WRITE_TOKEN: 'fixture-blob-credential', VERCEL_OIDC_TOKEN: 'fixture-oidc-credential',
    VERCEL_DEPLOYMENT_ID: 'deployment-id', GITHUB_TOKEN: OTHER_FIXTURE_SECRET,
    VERCEL_URL: 'runtime.example', T3MP3ST_HOSTED: 'false',
  }, { stateDir: '/tmp/state', configDir: '/tmp/config', port: 3000 });
  assert.equal(env.OPENAI_API_KEY, OPENAI_FIXTURE_SECRET);
  assert.equal(env.T3MP3ST_HOSTED, 'true');
  assert.equal(env.VERCEL_URL, 'runtime.example');
  for (const key of ['BLOB_READ_WRITE_TOKEN', 'VERCEL_OIDC_TOKEN', 'VERCEL_DEPLOYMENT_ID', 'GITHUB_TOKEN']) assert.equal(env[key], undefined);
  assert.equal(writerEpochFromEnvironment({}), 0);
  assert.throws(() => writerEpochFromEnvironment({ T3MP3ST_WRITER_EPOCH: '-1' }), /invalid_writer_epoch/);
});

test('private Blob SDK adapter uses uncached authenticated reads and checks returned URLs without auth', async () => {
  let sdkGetOptions;
  let sdkPutOptions;
  let privacyFetch;
  const adapter = createBlobAdapter({
    token: 'supervisor-only-token',
    get: async (_key, options) => {
      sdkGetOptions = options;
      return { blob: { etag: 'read-etag', url: 'https://private.blob.test/snapshot' }, stream: new Response('body').body };
    },
    put: async (_key, _bytes, options) => {
      sdkPutOptions = options;
      return { etag: 'put-etag', url: 'https://private.blob.test/snapshot' };
    },
    fetchImpl: async (url, options) => {
      privacyFetch = { url, options };
      return new Response(null, { status: 403 });
    },
  });
  const read = await adapter.get('key');
  assert.equal(read.etag, 'read-etag');
  assert.equal(sdkGetOptions.access, 'private');
  assert.equal(sdkGetOptions.useCache, false);
  assert.equal(sdkGetOptions.token, 'supervisor-only-token');
  const put = await adapter.put('key', Buffer.from('body'), { allowOverwrite: false, contentType: 'application/json' });
  assert.equal(put.etag, 'put-etag');
  assert.equal(sdkPutOptions.allowOverwrite, false);
  assert.equal(sdkPutOptions.addRandomSuffix, false);
  assert.equal(sdkPutOptions.access, 'private');
  assert.equal(sdkPutOptions.token, 'supervisor-only-token');
  const check = await adapter.verifyPrivateRead(put.url);
  assert.deepEqual(check, { denied: true, status: 403 });
  assert.equal(privacyFetch.url, put.url);
  assert.equal(privacyFetch.options.method, 'GET');
  assert.equal(privacyFetch.options.redirect, 'error');
  assert.equal(privacyFetch.options.headers, undefined);
  assert.ok(privacyFetch.options.signal);
});

test('runtime status has a sanitized stable schema and omits raw exception content', async t => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const status = createRuntimeStatus({ deploymentId: 'dpl-test', bootId: 'boot-test', uid: 1000 });
  setPersistenceStatus(status, { revision: 4, readOnly: false, persistenceReady: true, leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(), legacyUnchanged: true, legacyDigests: { a: 'digest' } });
  status.persistence.privateReadCheck = { checked: true, denied: true, status: 403, checkedAt: new Date(0).toISOString() };
  setStatusError(status, 'storage_unavailable');
  await writeRuntimeStatus(join(item.root, 'runtime-status.json'), status);
  const saved = JSON.parse(await readFile(join(item.root, 'runtime-status.json'), 'utf8'));
  assert.equal(saved.schemaVersion, RUNTIME_STATUS_SCHEMA);
  assert.equal(saved.revision, 4);
  assert.ok(Date.parse(saved.leaseExpiresAt) > Date.now());
  assert.equal(saved.persistence.privateReadCheck.denied, true);
  assert.equal(saved.runtime.uid, 1000);
  assert.deepEqual(saved.lastError, { category: 'storage_unavailable', at: saved.lastError.at });
  setStatusError(status, 'Bearer raw-secret-token');
  assert.equal(status.lastError.category, 'runtime_error');
});

test('runtime status write queue recovers after a failed write and consumes callback errors', async () => {
  const status = createRuntimeStatus({ bootId: 'queue-test' });
  let attempts = 0;
  let failures = 0;
  const queue = createRuntimeStatusQueue({
    getPath: () => '/tmp/status',
    status,
    write: async () => { attempts += 1; if (attempts === 1) throw new Error('disk full with secret'); },
    onFailure: () => { failures += 1; throw new Error('reporting failed'); },
  });
  await queue.enqueue();
  assert.equal(queue.failure, 'runtime_status_write_failed');
  assert.equal(status.lastError.category, 'runtime_status_write_failed');
  assert.equal(failures, 1);
  await queue.enqueue();
  await queue.flush();
  assert.equal(queue.failure, null);
  assert.equal(attempts, 2);
});

test('LLM smoke copies only validated upstream status codes and omits raw error content', async () => {
  const status = createRuntimeStatus({ bootId: 'smoke-test', smokeEnabled: true });
  const responseBody = {
    upstreamStatus: 401,
    upstreamCode: 'invalid_api_key',
    upstreamParam: 'api_key',
    message: `raw provider detail ${OPENAI_FIXTURE_SECRET}`,
    upstreamParamUnsafe: 'Authorization',
  };
  await performLlmSmoke({
    port: 3000,
    status,
    fetchImpl: async () => new Response(JSON.stringify(responseBody), { status: 502 }),
  });
  assert.equal(status.llm.smoke.upstreamStatus, 401);
  assert.equal(status.llm.smoke.upstreamCode, 'invalid_api_key');
  assert.equal(status.llm.smoke.upstreamParam, 'api_key');
  assert.ok(!JSON.stringify(status).includes(OPENAI_FIXTURE_SECRET));
  assert.ok(!JSON.stringify(status).includes('raw provider detail'));
});

test('lease status becomes non-ready when the recorded writer lease expires', async t => {
  let currentTime = 1_000;
  const updates = [];
  const status = createRuntimeStatus({ bootId: 'lease-expiry-test' });
  const item = await fixture({ now: () => currentTime, onStatus: update => { updates.push(update); setPersistenceStatus(status, update); } });
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await seedLocalFiles(item);
  await restoredAndClaimed(item);
  assert.equal(updates.at(-1).persistenceReady, true);
  assert.equal(Date.parse(updates.at(-1).leaseExpiresAt), currentTime + 30_000);
  currentTime += 30_001;
  item.manager.reportStatus();
  assert.equal(updates.at(-1).persistenceReady, false);
  assert.equal(Date.parse(updates.at(-1).leaseExpiresAt), currentTime - 1);
  assert.equal(status.ready, false);
});

test('shutdown stops scheduling, waits for child close, flushes, then releases its lease', async () => {
  const order = [];
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => { order.push(`signal:${signal}`); };
  const result = await shutdownChildAndFlush({
    stopScheduling: () => order.push('stop'),
    child,
    signal: 'SIGTERM',
    closeChildImpl: async () => { order.push('await-close'); return { code: 0, signal: null, timedOut: false }; },
    flush: async () => { order.push('flush'); },
    releaseLease: async () => { order.push('release'); },
  });
  assert.deepEqual(order, ['stop', 'await-close', 'signal:SIGTERM', 'flush', 'release']);
  assert.equal(result.successful, true);
});

test('unexpected child signals and nonzero exits make shutdown unsuccessful', async () => {
  for (const childResult of [
    { code: null, signal: 'SIGKILL', timedOut: false },
    { code: 9, signal: null, timedOut: false },
  ]) {
    const result = await shutdownChildAndFlush({
      child: { exitCode: null, signalCode: null, kill() {} },
      closeChildImpl: async () => childResult,
      flush: async () => {},
    });
    assert.equal(result.successful, false);
  }
  const requested = await shutdownChildAndFlush({
    child: { exitCode: null, signalCode: null, kill() {} },
    signal: 'SIGTERM',
    closeChildImpl: async () => ({ code: null, signal: 'SIGTERM', timedOut: false }),
    flush: async () => {},
  });
  assert.equal(requested.successful, true);
});

test('a failed post-spawn status write fails closed and still stops, flushes, and releases the child', async t => {
  const root = await mkdtemp(join(tmpdir(), 't3mp3st-supervisor-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const configDir = join(root, 'config');
  const statusPath = join(stateDir, 'runtime-status.json');
  const objects = new Map();
  const child = fakeChild();
  let childOptions;
  const environment = {
    BLOB_READ_WRITE_TOKEN: 'fixture-blob-credential',
    OPENAI_API_KEY: OPENAI_FIXTURE_SECRET,
    PORT: '38921',
    T3MP3ST_STATE_DIR: stateDir,
    T3MP3ST_CONFIG_DIR: configDir,
    T3MP3ST_RUN_SMOKE: 'true',
  };
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://api.openai.com/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }] }));
    if (url.startsWith('https://private.blob.test/')) return new Response(null, { status: 403 });
    if (url.endsWith('/api/llm/status')) {
      await rm(statusPath, { force: true });
      await mkdir(statusPath);
      return new Response('ok', { status: 200 });
    }
    if (url.endsWith('/api/llm/chat') && options.method === 'POST') return new Response('{"error":"synthetic"}', { status: 503 });
    throw new Error('unexpected fixture request');
  };
  const code = await runSupervisor({
    environment,
    fetchImpl,
    blobSdk: fakeBlobSdk(objects),
    spawnImpl: (_command, _args, options) => { childOptions = options; return child; },
  });
  assert.equal(code, 1);
  assert.equal(child.signalCode, 'SIGTERM');
  assert.equal(childOptions.env.OPENAI_API_KEY, OPENAI_FIXTURE_SECRET);
  assert.equal(childOptions.env.BLOB_READ_WRITE_TOKEN, undefined);
  const manifest = JSON.parse(objects.get('t3mp3st-runtime/v2/manifest.json').bytes.toString('utf8'));
  assert.ok(Date.parse(manifest.writer.leaseExpiresAt) <= Date.now());
});

test('T3MP3ST_READ_ONLY restores and serves liveness without claiming or publishing', async t => {
  const root = await mkdtemp(join(tmpdir(), 't3mp3st-supervisor-readonly-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const configDir = join(root, 'config');
  const objects = new Map();
  const child = fakeChild();
  let childOptions;
  const requestedUrls = [];
  const environment = {
    BLOB_READ_WRITE_TOKEN: 'fixture-blob-credential',
    PORT: '38922',
    T3MP3ST_STATE_DIR: stateDir,
    T3MP3ST_CONFIG_DIR: configDir,
    T3MP3ST_READ_ONLY: 'true',
    VERCEL_URL: 'runtime.example',
    VERCEL_OIDC_TOKEN: 'fixture-oidc-credential',
  };
  const fetchImpl = async url => {
    requestedUrls.push(url);
    if (url === 'http://127.0.0.1:38922/api/llm/status') {
      setImmediate(() => { child.exitCode = 0; child.emit('close', 0, null); });
      return new Response('ok', { status: 200 });
    }
    throw new Error('unexpected fixture request');
  };
  const code = await runSupervisor({
    environment,
    fetchImpl,
    blobSdk: fakeBlobSdk(objects),
    spawnImpl: (_command, _args, options) => { childOptions = options; return child; },
  });
  assert.equal(code, 0);
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:38922/api/llm/status']);
  assert.equal(childOptions.env.T3MP3ST_HOSTED, 'true');
  assert.equal(childOptions.env.T3MP3ST_STATE_DIR, stateDir);
  assert.equal(childOptions.env.VERCEL_URL, 'runtime.example');
  assert.equal(childOptions.env.VERCEL_OIDC_TOKEN, undefined);
  assert.equal(objects.size, 0);
  const status = JSON.parse(await readFile(join(stateDir, 'runtime-status.json'), 'utf8'));
  assert.equal(status.ready, false);
  assert.equal(status.readOnly, true);
});


test('a transient background status write failure remains a failed shutdown after recovery', { timeout: 15000 }, async t => {
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const root = await mkdtemp(join(tmpdir(), 't3mp3st-background-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = fakeChild();
  let stopped = false;
  child.kill = () => {
    stopped = true;
    child.exitCode = 0;
    child.signalCode = null;
    setImmediate(() => child.emit('close', 0, null));
  };
  let readySeen = false;
  let failedOnce = false;
  let recoveredWrites = 0;
  const code = await runSupervisor({
    environment: {
      BLOB_READ_WRITE_TOKEN: 'fixture-blob-credential',
      T3MP3ST_STATE_DIR: join(root, 'state'),
      T3MP3ST_CONFIG_DIR: join(root, 'config'),
      PORT: '38923',
    },
    spawnImpl: () => child,
    blobSdk: fakeBlobSdk(new Map()),
    fetchImpl: async url => {
      if (url.startsWith('https://private.blob.test/')) return new Response(null, { status: 403 });
      if (url.endsWith('/api/llm/status')) {
        readySeen = true;
        return new Response('ok', { status: 200 });
      }
      throw new Error('unexpected fixture request');
    },
    writeStatusImpl: async (path, status) => {
      if (readySeen && !failedOnce) {
        failedOnce = true;
        throw Object.assign(new Error('synthetic disk failure'), { code: 'ENOSPC' });
      }
      if (failedOnce) recoveredWrites += 1;
      await writeRuntimeStatus(path, status);
    },
  });
  assert.equal(failedOnce, true);
  assert.equal(stopped, true);
  assert.ok(recoveredWrites > 0);
  assert.equal(code, 1);
});
