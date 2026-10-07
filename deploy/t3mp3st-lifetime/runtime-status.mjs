import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const RUNTIME_STATUS_SCHEMA = 't3mp3st_runtime_status/v1';

export function createRuntimeStatus({ deploymentId = null, bootId, canaryEnabled = false, smokeEnabled = false, release = null, uid = null } = {}) {
  return {
    schemaVersion: RUNTIME_STATUS_SCHEMA,
    ready: false,
    readOnly: true,
    revision: 0,
    leaseExpiresAt: null,
    deploymentId,
    bootId,
    restoredFiles: [],
    restoredAt: null,
    lastSyncAt: null,
    legacyUnchanged: true,
    legacyDigests: {},
    lastError: null,
    runtime: { nodeVersion: process.version, uid, release },
    persistence: {
      ready: false,
      readOnly: true,
      revision: 0,
      leaseExpiresAt: null,
      lastSyncAt: null,
      privateReadCheck: { checked: false, denied: false, status: null, checkedAt: null },
    },
    llm: {
      ready: false,
      provider: 'openai',
      model: 'gpt-6.1-sol',
      checkedAt: null,
      error: 'not_checked',
      smoke: {
        enabled: smokeEnabled, complete: false, ok: false, marker: false, status: null,
        upstreamStatus: null, upstreamCode: null, upstreamParam: null,
      },
    },
    canary: {
      enabled: canaryEnabled,
      markerPresent: false,
      createdId: null,
      contentHash: null,
      revision: null,
      existedAtBoot: false,
      syncedAt: null,
    },
  };
}

export async function writeRuntimeStatus(path, status) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(status, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Queue status snapshots without letting one failed disk write poison later updates. */
export function createRuntimeStatusQueue({ getPath, status, write = writeRuntimeStatus, onFailure = () => {} }) {
  let queue = Promise.resolve();
  let failure = null;
  const enqueue = () => {
    const attempt = queue.catch(() => {}).then(() => {
      const path = getPath();
      return path ? write(path, status) : undefined;
    });
    queue = attempt.then(
      () => { failure = null; },
      () => {
        failure = 'runtime_status_write_failed';
        setStatusError(status, failure);
        try { onFailure(failure); } catch { /* Reporting must not create an unhandled rejection. */ }
      },
    );
    return queue;
  };
  return {
    enqueue,
    async flush() {
      await queue;
      if (failure) throw new Error(failure);
    },
    get failure() { return failure; },
  };
}

export function setPersistenceStatus(status, update) {
  status.revision = update.revision ?? status.revision;
  status.leaseExpiresAt = update.leaseExpiresAt !== undefined ? update.leaseExpiresAt : status.leaseExpiresAt;
  status.readOnly = Boolean(update.readOnly);
  status.ready = Boolean(update.persistenceReady) && !status.readOnly;
  status.lastSyncAt = update.lastSyncAt ?? status.lastSyncAt;
  status.legacyUnchanged = Boolean(update.legacyUnchanged);
  status.legacyDigests = update.legacyDigests ?? status.legacyDigests;
  status.persistence = {
    ...status.persistence,
    ready: Boolean(update.persistenceReady),
    readOnly: Boolean(update.readOnly),
    revision: status.revision,
    leaseExpiresAt: status.leaseExpiresAt,
    lastSyncAt: status.lastSyncAt,
  };
}

export function setStatusError(status, category, now = () => Date.now()) {
  const safeCategory = typeof category === 'string' && /^[a-z0-9_]{1,64}$/.test(category) ? category : 'runtime_error';
  status.lastError = { category: safeCategory, at: new Date(now()).toISOString() };
}
