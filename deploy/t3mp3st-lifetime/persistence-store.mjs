import {
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_FILES,
  SnapshotValidationError,
  exactSecretsFromEnvironment,
  installSnapshotBundle,
  readLocalSnapshots,
  sha256,
  validateAndSanitizeSnapshot,
  validateSnapshotBytes,
} from './persistence-files.mjs';

const LEGACY_KEYS = Object.freeze([
  'state/state.json',
  'state/events.jsonl',
  'config/config.json',
  'meta/runtime.json',
]);
const SAME_EPOCH_TAKEOVER_GRACE_MS = 2_000;

export class PersistenceError extends Error {
  constructor(category, options = {}) {
    super(category);
    this.name = 'PersistenceError';
    this.category = category;
    this.cause = options.cause;
  }
}

export function isCasConflict(error) {
  const name = `${error?.name || ''} ${error?.constructor?.name || ''}`;
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  const message = String(error?.message || '');
  const embeddedStatus = Number(message.match(/(?:status\s*|blob:\s*)(\d{3})\b/i)?.[1] || 0);
  return /preconditionfailed|precondition_failed|conditionnotmet/i.test(name)
    || status === 409 || status === 412 || embeddedStatus === 409 || embeddedStatus === 412
    || /precondition|if-match|already exists/i.test(message);
}

export function isTransientStorageError(error) {
  if (isCasConflict(error)) return false;
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  if ([408, 425, 429].includes(status) || status >= 500) return true;
  const name = `${error?.name || ''} ${error?.constructor?.name || ''}`;
  if (['TimeoutError', 'AbortError', 'BlobServiceNotAvailable', 'BlobServiceRateLimited', 'BlobRequestAbortedError'].some(expected => name.includes(expected))) return true;
  if (error instanceof TypeError || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNABORTED'].includes(error?.code)) return true;
  const message = String(error?.message || '');
  const match = message.match(/(?:status\s*|blob:\s*)(\d{3})\b/i);
  const parsed = match ? Number(match[1]) : 0;
  return [408, 425, 429].includes(parsed) || parsed >= 500;
}

export function isTypedMissingBlobError(error) {
  // Only the Blob SDK's typed not-found error is treated as an absent object.
  return error?.name === 'BlobNotFoundError' || error?.constructor?.name === 'BlobNotFoundError';
}

function parseManifest(bytes, prefix) {
  if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw new PersistenceError('manifest_too_large');
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new PersistenceError('invalid_manifest');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schema_version !== 't3mp3st_blob_state/v2'
    || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || !manifest.writer || typeof manifest.writer !== 'object'
    || typeof manifest.writer.owner !== 'string' || !manifest.writer.owner
    || !Number.isSafeInteger(manifest.writer.epoch) || manifest.writer.epoch < 0
    || !Number.isFinite(Date.parse(manifest.writer.leaseExpiresAt))) {
    throw new PersistenceError('invalid_manifest');
  }
  for (const [name, ref] of Object.entries(manifest.files)) {
    if (!SNAPSHOT_FILES.some(file => file.name === name)
      || !ref || typeof ref !== 'object'
      || !/^[a-f0-9]{64}$/.test(ref.sha256 || '')
      || ref.object !== `${prefix}/v2/snapshots/sha256/${ref.sha256}`
      || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > MAX_SNAPSHOT_BYTES
      || typeof ref.contentType !== 'string') {
      throw new PersistenceError('invalid_manifest');
    }
  }
  if (!manifest.legacyDigests || typeof manifest.legacyDigests !== 'object' || Array.isArray(manifest.legacyDigests)) {
    throw new PersistenceError('invalid_manifest');
  }
  for (const key of LEGACY_KEYS) {
    const value = manifest.legacyDigests[key];
    if (value !== null && !/^[a-f0-9]{64}$/.test(value || '')) throw new PersistenceError('invalid_manifest');
  }
  return manifest;
}

function digestMapEqual(left, right) {
  return LEGACY_KEYS.every(key => (left?.[key] ?? null) === (right?.[key] ?? null));
}

export class SnapshotPersistence {
  constructor({
    adapter,
    prefix,
    legacyPrefix = 't3mp3st-runtime/v1',
    fileMap,
    ownerId,
    epoch = 0,
    leaseMs = 30_000,
    retryAttempts = 3,
    backoffMs = 100,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = () => Date.now(),
    environment = process.env,
    readOnly = false,
    onStatus = () => {},
    onPrivateReadCheck = () => {},
  }) {
    if (!adapter || typeof adapter.get !== 'function' || typeof adapter.put !== 'function') throw new TypeError('adapter is required');
    if (!/^[a-zA-Z0-9/_-]+$/.test(prefix || '') || prefix.startsWith('/') || prefix.endsWith('/')) throw new TypeError('invalid blob prefix');
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError('writer epoch must be a non-negative integer');
    this.adapter = adapter;
    this.prefix = prefix;
    if (!/^[a-zA-Z0-9/_-]+$/.test(legacyPrefix) || legacyPrefix.startsWith('/') || legacyPrefix.endsWith('/')) throw new TypeError('invalid legacy prefix');
    this.legacyPrefix = legacyPrefix;
    this.fileMap = fileMap;
    this.ownerId = ownerId;
    this.epoch = epoch;
    this.leaseMs = leaseMs;
    this.retryAttempts = retryAttempts;
    this.backoffMs = backoffMs;
    this.sleep = sleep;
    this.now = now;
    this.exactSecrets = exactSecretsFromEnvironment(environment);
    this.onStatus = onStatus;
    this.onPrivateReadCheck = onPrivateReadCheck;
    this.privateReadCheck = { checked: false, denied: false, status: null, checkedAt: null };
    this.manifest = null;
    this.manifestEtag = null;
    this.seedLegacyDigests = null;
    this.legacyDigests = Object.fromEntries(LEGACY_KEYS.map(key => [key, null]));
    this.legacyUnchanged = true;
    this.readOnly = Boolean(readOnly);
    this.explicitReadOnly = Boolean(readOnly);
    this.leaseAcquired = false;
    this.syncChain = Promise.resolve();
    this.lastSyncAt = null;
    this.restoredFiles = [];
  }

  manifestKey() { return `${this.prefix}/v2/manifest.json`; }
  legacyKey(name) { return `${this.legacyPrefix}/${name}`; }

  async callWithRetry(operation) {
    let lastError;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try { return await operation(); }
      catch (error) {
        lastError = error;
        if (attempt >= this.retryAttempts || !isTransientStorageError(error)) break;
        await this.sleep(Math.min(this.backoffMs * (2 ** (attempt - 1)), 800));
      }
    }
    throw new PersistenceError(isTransientStorageError(lastError) ? 'storage_unavailable' : 'storage_operation_failed', { cause: lastError });
  }

  async readBlob(key) {
    return this.callWithRetry(async () => {
      try { return await this.adapter.get(key); }
      catch (error) { if (isTypedMissingBlobError(error)) return null; throw error; }
    });
  }

  async readHead() {
    const result = await this.readBlob(this.manifestKey());
    if (!result) return null;
    if (!Buffer.isBuffer(result.bytes) || typeof result.etag !== 'string' || !result.etag) throw new PersistenceError('invalid_manifest_response');
    return { manifest: parseManifest(result.bytes, this.prefix), etag: result.etag };
  }

  async readLegacyDigests() {
    const digests = {};
    for (const key of LEGACY_KEYS) {
      const legacy = await this.readBlob(this.legacyKey(key));
      if (legacy && !Buffer.isBuffer(legacy.bytes)) throw new PersistenceError('invalid_legacy_response');
      if (legacy && legacy.bytes.length > MAX_SNAPSHOT_BYTES) throw new PersistenceError('snapshot_too_large');
      digests[key] = legacy ? sha256(legacy.bytes) : null;
      if (key === 'state/state.json' || key === 'state/events.jsonl' || key === 'config/config.json') {
        if (!legacy) continue;
        const descriptor = SNAPSHOT_FILES.find(file => file.name === key);
        try { validateSnapshotBytes(descriptor.kind, legacy.bytes); }
        catch (error) { throw new PersistenceError(error.category || 'invalid_legacy_snapshot', { cause: error }); }
        this.legacyPayloads ??= new Map();
        this.legacyPayloads.set(key, validateAndSanitizeSnapshot(descriptor.kind, legacy.bytes, this.exactSecrets));
      }
    }
    return digests;
  }

  async loadManifestBundle(head) {
    const bundle = new Map();
    for (const descriptor of SNAPSHOT_FILES) {
      const ref = head.manifest.files[descriptor.name];
      if (!ref) continue;
      const snapshot = await this.readBlob(ref.object);
      if (!snapshot) throw new PersistenceError('missing_snapshot');
      if (!Buffer.isBuffer(snapshot.bytes) || snapshot.bytes.length !== ref.bytes || sha256(snapshot.bytes) !== ref.sha256) {
        throw new PersistenceError('snapshot_integrity_failed');
      }
      try { validateSnapshotBytes(descriptor.kind, snapshot.bytes); }
      catch (error) { throw new PersistenceError(error.category || 'invalid_snapshot', { cause: error }); }
      await this.verifyPrivateSnapshotUrl(snapshot.url);
      const bytes = validateAndSanitizeSnapshot(descriptor.kind, snapshot.bytes, this.exactSecrets);
      bundle.set(descriptor.name, { bytes });
    }
    return bundle;
  }

  async restore() {
    const head = await this.readHead();
    const legacyDigests = await this.readLegacyDigests();
    this.legacyDigests = legacyDigests;
    let bundle;
    if (head) {
      bundle = await this.loadManifestBundle(head);
      if (!bundle.has('config/config.json') && this.legacyPayloads?.has('config/config.json')) {
        bundle.set('config/config.json', { bytes: this.legacyPayloads.get('config/config.json') });
      }
      this.manifest = head.manifest;
      this.manifestEtag = head.etag;
      this.seedLegacyDigests = head.manifest.legacyDigests;
      this.legacyUnchanged = digestMapEqual(this.seedLegacyDigests, legacyDigests);
    } else {
      this.seedLegacyDigests = legacyDigests;
      this.legacyPayloads ??= new Map();
      bundle = new Map();
      for (const [name, bytes] of this.legacyPayloads) bundle.set(name, { bytes });
    }
    if (bundle.size) await installSnapshotBundle(bundle, this.fileMap);
    this.restoredFiles = [...bundle.keys()];
    return { restoredFiles: this.restoredFiles, revision: this.manifest?.revision ?? 0, legacyDigests: this.legacyDigests, legacyUnchanged: this.legacyUnchanged };
  }

  async recheckLegacy() {
    const current = await this.readLegacyDigests();
    this.legacyDigests = current;
    this.legacyUnchanged = digestMapEqual(this.seedLegacyDigests || current, current);
    if (!this.legacyUnchanged) {
      this.readOnly = true;
      this.leaseAcquired = false;
    }
    this.reportStatus();
    return { unchanged: this.legacyUnchanged, digests: current };
  }

  reportStatus() {
    const leaseExpiresAt = this.manifest?.writer?.leaseExpiresAt ?? null;
    this.onStatus({
      revision: this.manifest?.revision ?? 0,
      readOnly: this.readOnly,
      persistenceReady: this.leaseAcquired && Number.isFinite(Date.parse(leaseExpiresAt)) && Date.parse(leaseExpiresAt) > this.now(),
      leaseExpiresAt,
      legacyUnchanged: this.legacyUnchanged,
      legacyDigests: this.legacyDigests,
      lastSyncAt: this.lastSyncAt,
      claim: this.claimStatus ?? null,
    });
  }

  async uploadImmutable(ref, bytes) {
    const existing = await this.readBlob(ref.object);
    if (existing) {
      if (!Buffer.isBuffer(existing.bytes) || existing.bytes.length !== ref.bytes || sha256(existing.bytes) !== ref.sha256) {
        throw new PersistenceError('immutable_object_collision');
      }
      await this.verifyPrivateSnapshotUrl(existing.url);
      return;
    }
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        await this.adapter.put(ref.object, bytes, { allowOverwrite: false, addRandomSuffix: false, contentType: ref.contentType });
        const readBack = await this.readBlob(ref.object);
        if (!readBack) throw new PersistenceError('missing_snapshot_after_upload');
        if (!Buffer.isBuffer(readBack.bytes) || readBack.bytes.length !== ref.bytes || sha256(readBack.bytes) !== ref.sha256) {
          throw new PersistenceError('snapshot_integrity_failed');
        }
        await this.verifyPrivateSnapshotUrl(readBack.url);
        return;
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        if (isCasConflict(error)) {
          const afterConflict = await this.readBlob(ref.object);
          if (!afterConflict || !Buffer.isBuffer(afterConflict.bytes) || sha256(afterConflict.bytes) !== ref.sha256 || afterConflict.bytes.length !== ref.bytes) {
            throw new PersistenceError('immutable_object_collision', { cause: error });
          }
          await this.verifyPrivateSnapshotUrl(afterConflict.url);
          return;
        }
        if (!isTransientStorageError(error) || attempt >= this.retryAttempts) {
          throw new PersistenceError(isTransientStorageError(error) ? 'storage_unavailable' : 'storage_operation_failed', { cause: error });
        }
        await this.sleep(Math.min(this.backoffMs * (2 ** (attempt - 1)), 800));
        // A timed-out PUT may have committed; fetch and validate before attempting another create.
        const afterTransient = await this.readBlob(ref.object);
        if (afterTransient) {
          if (!Buffer.isBuffer(afterTransient.bytes) || afterTransient.bytes.length !== ref.bytes || sha256(afterTransient.bytes) !== ref.sha256) {
            throw new PersistenceError('immutable_object_collision');
          }
          await this.verifyPrivateSnapshotUrl(afterTransient.url);
          return;
        }
      }
    }
  }

  async putManifestCas(manifest, bytes) {
    const baseEtag = this.manifestEtag;
    const options = baseEtag
      ? { ifMatch: baseEtag, allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' }
      : { allowOverwrite: false, addRandomSuffix: false, contentType: 'application/json' };
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await this.adapter.put(this.manifestKey(), bytes, options);
      } catch (error) {
        if (isCasConflict(error)) throw new PersistenceError('writer_fenced', { cause: error });
        if (!isTransientStorageError(error)) {
          throw new PersistenceError(isTransientStorageError(error) ? 'storage_unavailable' : 'storage_operation_failed', { cause: error });
        }
        if (attempt < this.retryAttempts) await this.sleep(Math.min(this.backoffMs * (2 ** (attempt - 1)), 800));
        // A timed-out conditional write may have committed even on the final attempt.
        const observed = await this.readHead();
        if (observed && JSON.stringify(observed.manifest) === JSON.stringify(manifest)) return { etag: observed.etag };
        if ((baseEtag && observed?.etag !== baseEtag) || (!baseEtag && observed)) {
          throw new PersistenceError('writer_fenced', { cause: error });
        }
        if (attempt >= this.retryAttempts) throw new PersistenceError('storage_unavailable', { cause: error });
      }
    }
    throw new PersistenceError('storage_unavailable');
  }

  async verifyPrivateSnapshotUrl(url) {
    if (this.privateReadCheck.checked && this.privateReadCheck.denied) return;
    if (!url || typeof this.adapter.verifyPrivateRead !== 'function') {
      this.privateReadCheck = { checked: false, denied: false, status: null, checkedAt: new Date(this.now()).toISOString() };
      this.onPrivateReadCheck(this.privateReadCheck);
      throw new PersistenceError('private_read_check_unavailable');
    }
    let lastCheck;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try { lastCheck = await this.adapter.verifyPrivateRead(url); }
      catch { lastCheck = { denied: false, status: null }; }
      if (lastCheck?.denied && [401, 403, 404].includes(lastCheck.status)) {
        this.privateReadCheck = { denied: true, status: lastCheck.status, checked: true, checkedAt: new Date(this.now()).toISOString() };
        this.onPrivateReadCheck(this.privateReadCheck);
        return;
      }
      if (lastCheck?.status && lastCheck.status < 500 && lastCheck.status !== 429) {
        this.privateReadCheck = { denied: false, status: lastCheck.status, checked: false, checkedAt: new Date(this.now()).toISOString() };
        this.onPrivateReadCheck(this.privateReadCheck);
        throw new PersistenceError('private_snapshot_accessible');
      }
      if (attempt < this.retryAttempts) await this.sleep(Math.min(this.backoffMs * (2 ** (attempt - 1)), 800));
    }
    this.privateReadCheck = { denied: false, status: lastCheck?.status ?? null, checked: false, checkedAt: new Date(this.now()).toISOString() };
    this.onPrivateReadCheck(this.privateReadCheck);
    throw new PersistenceError('private_read_check_failed');
  }

  async localBundle() {
    return readLocalSnapshots(this.fileMap, this.exactSecrets);
  }

  async publish({ force = false, renew = false } = {}) {
    if (this.readOnly) return false;
    const bundle = await this.localBundle();
    const previousFiles = this.manifest?.files || {};
    const nextFiles = { ...previousFiles };
    let changed = !this.manifest;
    for (const descriptor of SNAPSHOT_FILES) {
      const item = bundle.get(descriptor.name);
      if (!item) continue; // A transient local absence must never erase committed state.
      const currentRef = previousFiles[descriptor.name];
      if (!force && currentRef?.sha256 === item.hash && currentRef.bytes === item.bytes.length) continue;
      const ref = {
        sha256: item.hash,
        bytes: item.bytes.length,
        contentType: item.contentType,
        object: `${this.prefix}/v2/snapshots/sha256/${item.hash}`,
      };
      await this.uploadImmutable(ref, item.bytes);
      nextFiles[descriptor.name] = ref;
      if (currentRef?.sha256 !== ref.sha256 || currentRef?.bytes !== ref.bytes) changed = true;
    }

    const now = this.now();
    const writer = { owner: this.ownerId, epoch: this.epoch, leaseExpiresAt: new Date(now + this.leaseMs).toISOString() };
    const previousRevision = this.manifest?.revision || 0;
    const manifest = {
      schema_version: 't3mp3st_blob_state/v2',
      revision: previousRevision + 1,
      parentRevision: this.manifest?.revision ?? null,
      updatedAt: new Date(now).toISOString(),
      files: nextFiles,
      writer,
      legacyDigests: this.seedLegacyDigests || Object.fromEntries(LEGACY_KEYS.map(key => [key, null])),
    };
    if (!changed && !renew && this.manifest && Date.parse(this.manifest.writer.leaseExpiresAt) - now > this.leaseMs / 2) return false;
    const bytes = Buffer.from(JSON.stringify(manifest));
    try {
      const result = await this.putManifestCas(manifest, bytes);
      if (!result || typeof result.etag !== 'string' || !result.etag) throw new PersistenceError('manifest_etag_missing');
      this.manifest = manifest;
      this.manifestEtag = result.etag;
      this.leaseAcquired = true;
      this.lastSyncAt = new Date(now).toISOString();
      this.reportStatus();
      return true;
    } catch (error) {
      if (error?.category === 'writer_fenced' || isCasConflict(error)) {
        this.readOnly = true;
        this.leaseAcquired = false;
        this.reportStatus();
        throw new PersistenceError('writer_fenced', { cause: error });
      }
      throw error;
    }
  }

  async claim() {
    if (this.readOnly) { this.reportStatus(); return false; }
    if (this.manifest) {
      const currentEpoch = this.manifest.writer.epoch;
      const ownerMatches = this.manifest.writer.owner === this.ownerId && currentEpoch === this.epoch;
      const expired = Date.parse(this.manifest.writer.leaseExpiresAt) + SAME_EPOCH_TAKEOVER_GRACE_MS <= this.now();
      if (!ownerMatches && (this.epoch < currentEpoch || (this.epoch === currentEpoch && !expired))) {
        this.readOnly = true;
        this.claimStatus = { category: this.epoch < currentEpoch ? 'older_epoch' : 'lease_active', attemptedEpoch: this.epoch, currentEpoch, revision: this.manifest.revision, ownerMatches };
        this.reportStatus();
        return false;
      }
    }
    try {
      await this.publish({ force: !this.manifest, renew: true });
      return this.leaseAcquired;
    } catch (error) {
      if (error?.category !== 'writer_fenced') throw error;
      // A failed CAS never proves ownership: refresh even an existing head for accurate diagnostics.
      const previousEtag = this.manifestEtag;
      const fresh = await this.readHead();
      if (fresh && this.manifest) {
        this.manifest = fresh.manifest;
        this.manifestEtag = fresh.etag;
      }
      this.claimStatus = {
        category: fresh?.etag === previousEtag ? 'conditional_write_rejected' : 'writer_conflict',
        attemptedEpoch: this.epoch,
        currentEpoch: fresh?.manifest.writer.epoch ?? null,
        revision: fresh?.manifest.revision ?? null,
        ownerMatches: fresh?.manifest.writer.owner === this.ownerId,
      };
      // A first-head race can only be resolved by a fresh read and a fenced decision.
      if (!this.manifest) {
        const raced = await this.readHead();
        if (raced) {
          this.manifest = raced.manifest;
          this.manifestEtag = raced.etag;
          const latest = await this.loadManifestBundle(raced);
          if (latest.size) await installSnapshotBundle(latest, this.fileMap);
          const epoch = raced.manifest.writer.epoch;
          const expiry = Date.parse(raced.manifest.writer.leaseExpiresAt);
          if (raced.manifest.writer.owner === this.ownerId && epoch === this.epoch) {
            this.readOnly = false;
            this.leaseAcquired = true;
            this.reportStatus();
            return true;
          }
          if (this.epoch > epoch || (this.epoch === epoch && expiry + SAME_EPOCH_TAKEOVER_GRACE_MS <= this.now())) {
            this.readOnly = false;
            try { await this.publish({ force: false, renew: true }); return this.leaseAcquired; }
            catch (retryError) { if (retryError?.category !== 'writer_fenced') throw retryError; }
          }
        }
      }
      this.readOnly = true;
      this.leaseAcquired = false;
      this.reportStatus();
      return false;
    }
  }

  sync(options = {}) {
    const task = () => this.publish(options);
    const result = this.syncChain.then(task, task);
    this.syncChain = result.catch(() => {});
    return result;
  }

  async flush() {
    await this.syncChain;
    if (this.readOnly) {
      if (this.explicitReadOnly) return false;
      const local = await this.localBundle();
      const refs = this.manifest?.files || {};
      const hasUncommitted = [...local.entries()].some(([name, item]) => refs[name]?.sha256 !== item.hash || refs[name]?.bytes !== item.bytes.length);
      if (hasUncommitted) throw new PersistenceError('writer_read_only');
      return false;
    }
    return this.sync({ force: true });
  }

  async releaseLease() {
    const task = async () => {
      if (!this.leaseAcquired || this.readOnly || !this.manifest || !this.manifestEtag) return false;
      const now = this.now();
      const manifest = {
        ...this.manifest,
        revision: this.manifest.revision + 1,
        parentRevision: this.manifest.revision,
        updatedAt: new Date(now).toISOString(),
        writer: { ...this.manifest.writer, leaseExpiresAt: new Date(now).toISOString() },
      };
      try {
        const result = await this.adapter.put(this.manifestKey(), Buffer.from(JSON.stringify(manifest)), {
          ifMatch: this.manifestEtag,
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType: 'application/json',
        });
        if (!result || typeof result.etag !== 'string' || !result.etag) throw new PersistenceError('manifest_etag_missing');
        this.manifest = manifest;
        this.manifestEtag = result.etag;
        this.leaseAcquired = false;
        this.lastSyncAt = new Date(now).toISOString();
        this.reportStatus();
        return true;
      } catch (error) {
        if (isCasConflict(error)) {
          this.readOnly = true;
          this.leaseAcquired = false;
          this.reportStatus();
          throw new PersistenceError('writer_fenced', { cause: error });
        }
        throw new PersistenceError('lease_release_failed', { cause: error });
      }
    };
    const result = this.syncChain.then(task, task);
    this.syncChain = result.catch(() => {});
    return result;
  }

  get revision() { return this.manifest?.revision ?? 0; }
  get leaseExpiresAt() { return this.manifest?.writer?.leaseExpiresAt ?? null; }
}

export function createBlobAdapter({ get, put, token, timeoutMs = 10_000, fetchImpl = fetch }) {
  return {
    async get(pathname) {
      let result;
      try {
        result = await get(pathname, {
          access: 'private',
          useCache: false,
          token,
          abortSignal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTypedMissingBlobError(error)) return null;
        throw error;
      }
      if (!result) return null;
      if (!result.stream) throw new PersistenceError('invalid_blob_stream');
      const chunks = [];
      let size = 0;
      for await (const chunk of result.stream) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_SNAPSHOT_BYTES) {
          await result.stream.cancel?.().catch(() => {});
          throw new PersistenceError('snapshot_too_large');
        }
        chunks.push(buffer);
      }
      const bytes = Buffer.concat(chunks, size);
      return { bytes, etag: result.blob?.etag || '', url: result.blob?.url || '' };
    },
    async put(pathname, bytes, options = {}) {
      const result = await put(pathname, bytes, {
        access: 'private',
        token,
        abortSignal: AbortSignal.timeout(timeoutMs),
        contentType: options.contentType || 'application/octet-stream',
        addRandomSuffix: false,
        ...(options.allowOverwrite === undefined ? {} : { allowOverwrite: options.allowOverwrite }),
        ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
      });
      return { etag: result.etag, url: result.url || '' };
    },
    async verifyPrivateRead(url) {
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const status = response.status;
        await response.body?.cancel().catch(() => {});
        return { denied: [401, 403, 404].includes(status), status };
      } catch (error) {
        return { denied: false, status: null, errorCategory: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'request_failed' };
      }
    },
  };
}

export const LEGACY_SOURCE_KEYS = LEGACY_KEYS;
