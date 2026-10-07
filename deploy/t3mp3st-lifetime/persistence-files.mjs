import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export const SNAPSHOT_FILES = Object.freeze([
  { name: 'state/state.json', kind: 'state', contentType: 'application/json' },
  { name: 'state/events.jsonl', kind: 'events', contentType: 'application/x-ndjson' },
  { name: 'config/config.json', kind: 'config', contentType: 'application/json' },
]);
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

const STATE_ARRAYS = Object.freeze([
  'missionDrafts', 'improvementProposals', 'approvalRequests', 'evidenceLedger',
  'findingsLedger', 'retestLedger', 'hypothesisLedger', 'workOrderLedger',
  'watchCycleLedger', 'memoryCapsule', 'memoryProposals',
]);

export class SnapshotValidationError extends Error {
  constructor(category) {
    super(category);
    this.name = 'SnapshotValidationError';
    this.category = category;
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function readFileBounded(path, maxBytes = MAX_SNAPSHOT_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    size += chunk.length;
    if (size > maxBytes) throw new SnapshotValidationError('snapshot_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function parseObject(bytes, category) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new SnapshotValidationError(category);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnapshotValidationError(category);
  }
  return value;
}

function validRecordList(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

export function validateSnapshotBytes(kind, bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length > MAX_SNAPSHOT_BYTES) throw new SnapshotValidationError('snapshot_too_large');
  if (kind === 'state') {
    const state = parseObject(raw, 'invalid_state_json');
    if (state.schema_version !== 't3mp3st_state/v1' || !STATE_ARRAYS.every(key => validRecordList(state[key]))) {
      throw new SnapshotValidationError('invalid_state_schema');
    }
    return state;
  }
  if (kind === 'events') {
    const text = raw.toString('utf8');
    if (!text) return [];
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const events = [];
    for (const line of lines) {
      if (!line.trim()) throw new SnapshotValidationError('invalid_events_jsonl');
      const event = parseObject(Buffer.from(line), 'invalid_events_jsonl');
      if (typeof event.ts !== 'string' || !Number.isFinite(Date.parse(event.ts))
        || typeof event.type !== 'string' || !event.type.trim()
        || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
        throw new SnapshotValidationError('invalid_events_jsonl');
      }
      events.push(event);
    }
    return events;
  }
  if (kind === 'config') {
    const config = parseObject(raw, 'invalid_config_json');
    if (('apiKeys' in config && (!config.apiKeys || typeof config.apiKeys !== 'object' || Array.isArray(config.apiKeys)))
      || ('defaultProvider' in config && typeof config.defaultProvider !== 'string')
      || ('defaultModel' in config && typeof config.defaultModel !== 'string')
      || ('openai' in config && (!config.openai || typeof config.openai !== 'object' || Array.isArray(config.openai)))) {
      throw new SnapshotValidationError('invalid_config_schema');
    }
    return config;
  }
  throw new SnapshotValidationError('unknown_snapshot_kind');
}

const SECRET_PROPERTY = /(?:^|[_-])(?:api[_-]?keys?|tokens?|secrets?|passwords?|credentials?|private[_-]?keys?)(?:$|[_-])/i;

function scrubValue(value, exactSecrets) {
  if (Array.isArray(value)) return value.map(item => scrubValue(item, exactSecrets));
  if (value && typeof value === 'object') {
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_PROPERTY.test(key) || /^(?:apiKeys|apiKey|accessToken|refreshToken|secret|password|credential)$/i.test(key)) continue;
      clean[key] = scrubValue(item, exactSecrets);
    }
    return clean;
  }
  if (typeof value === 'string') {
    let clean = value;
    for (const secret of exactSecrets) clean = clean.split(secret).join('[REDACTED]');
    return clean;
  }
  return value;
}

export function exactSecretsFromEnvironment(environment = process.env) {
  return Object.entries(environment)
    .filter(([name, value]) => /(?:^|_)(?:API_KEYS?|ACCESS_KEY_ID|ACCESS_KEYS?|PRIVATE_KEYS?|AUTH_TOKENS?|ACCESS_TOKENS?|REFRESH_TOKENS?|READ_WRITE_TOKENS?|OIDC_TOKENS?|CLIENT_SECRET|SECRET(?:_KEY)?|PASSWORDS?|CREDENTIALS?|TOKEN|KEY)$/i.test(name)
      && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function sanitizeSnapshotBytes(kind, bytes, exactSecrets = []) {
  const value = validateSnapshotBytes(kind, bytes);
  if (kind === 'events') {
    const text = Buffer.from(bytes).toString('utf8');
    if (!text) return Buffer.alloc(0);
    const lines = text.split('\n');
    const trailingNewline = lines.at(-1) === '';
    if (trailingNewline) lines.pop();
    const clean = lines.map(line => JSON.stringify(scrubValue(JSON.parse(line), exactSecrets)));
    const output = Buffer.from(clean.join('\n') + (trailingNewline ? '\n' : ''), 'utf8');
    if (output.length > MAX_SNAPSHOT_BYTES) throw new SnapshotValidationError('snapshot_too_large');
    return output;
  }
  const output = Buffer.from(JSON.stringify(scrubValue(value, exactSecrets), null, 2), 'utf8');
  if (output.length > MAX_SNAPSHOT_BYTES) throw new SnapshotValidationError('snapshot_too_large');
  return output;
}

export function validateAndSanitizeSnapshot(kind, bytes, exactSecrets = []) {
  const clean = sanitizeSnapshotBytes(kind, bytes, exactSecrets);
  validateSnapshotBytes(kind, clean);
  return clean;
}

export async function readLocalSnapshots(fileMap, exactSecrets = []) {
  const bundle = new Map();
  for (const entry of SNAPSHOT_FILES) {
    try {
      const raw = await readFileBounded(fileMap[entry.name]);
      const clean = validateAndSanitizeSnapshot(entry.kind, raw, exactSecrets);
      bundle.set(entry.name, { bytes: clean, hash: sha256(clean), contentType: entry.contentType });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
  return bundle;
}

/** Validate the full bundle, stage all files, then rename with rollback on I/O failure. */
export async function installSnapshotBundle(bundle, fileMap) {
  const entries = [...bundle.entries()];
  for (const [name, item] of entries) {
    const descriptor = SNAPSHOT_FILES.find(file => file.name === name);
    if (!descriptor || !item || !Buffer.isBuffer(item.bytes) || item.bytes.length > MAX_SNAPSHOT_BYTES) throw new SnapshotValidationError('invalid_bundle');
    validateSnapshotBytes(descriptor.kind, item.bytes);
  }

  const staged = [];
  const installed = [];
  try {
    for (const [name, item] of entries) {
      const target = fileMap[name];
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
      staged.push({ target, temp, backup: null });
      await writeFile(temp, item.bytes, { mode: 0o600, flag: 'wx' });
    }
    for (const item of staged) {
      try {
        const backup = `${item.target}.${process.pid}.${Math.random().toString(16).slice(2)}.rollback`;
        await rename(item.target, backup);
        item.backup = backup;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(item.temp, item.target);
      installed.push(item);
    }
  } catch (error) {
    for (const item of installed.reverse()) {
      await rm(item.target, { force: true }).catch(() => {});
      if (item.backup) await rename(item.backup, item.target).catch(() => {});
    }
    for (const item of staged) {
      await rm(item.temp, { force: true }).catch(() => {});
      if (item.backup && !installed.some(done => done.backup === item.backup)) {
        await rename(item.backup, item.target).catch(() => {});
      }
    }
    throw error;
  }
  await Promise.all(installed.filter(item => item.backup).map(item => rm(item.backup, { force: true }).catch(() => {})));
}

export function buildSnapshotFileMap(stateDir, configDir) {
  return {
    'state/state.json': join(stateDir, 'state.json'),
    'state/events.jsonl': join(stateDir, 'events.jsonl'),
    'config/config.json': join(configDir, 'config.json'),
  };
}
