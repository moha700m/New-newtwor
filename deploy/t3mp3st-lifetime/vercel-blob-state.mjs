import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SnapshotPersistence, createBlobAdapter } from './persistence-store.mjs';
import { buildSnapshotFileMap, readFileBounded, sanitizeSnapshotBytes, sha256, validateSnapshotBytes } from './persistence-files.mjs';
import { buildChildEnvironment, buildRuntimeConfig, resolveOpenAIModel, writerEpochFromEnvironment, writeRuntimeConfig } from './runtime-config.mjs';
import { createRuntimeStatus, createRuntimeStatusQueue, setPersistenceStatus, setStatusError, writeRuntimeStatus } from './runtime-status.mjs';
import { shutdownChildAndFlush, waitForHttpReady } from './supervisor-lifecycle.mjs';

function log(category, fields = {}) {
  process.stdout.write(`${JSON.stringify({ component: 't3mp3st-supervisor', category, ...fields })}\n`);
}

function requireDirectory(value, fallback, name) {
  const path = value || fallback;
  if (!isAbsolute(path)) throw new Error(`invalid_${name}_directory`);
  return path;
}

function portFromEnvironment(environment) {
  const value = Number(environment.PORT || environment.T3MP3ST_PORT || '3000');
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new Error('invalid_port');
  return value;
}

async function loadReleaseMetadata(environment = process.env) {
  const fallback = {
      release: 'unknown',
      sourceRepository: 'elder-plinius/T3MP3ST',
      upstreamCommit: '29824d5625ede419ac8cdae418c8f4c72c6270f7',
      sourceCommit: null,
  };
  try {
    const value = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'release.json'), 'utf8'));
    const sourceRepository = value.sourceRepository || value.source || value.repository || fallback.sourceRepository;
    const upstreamCommit = value.upstreamCommit || value.upstreamVersion || value.commit || fallback.upstreamCommit;
    const release = value.release || fallback.release;
    return {
      release: String(release).slice(0, 120),
      sourceRepository: String(sourceRepository).slice(0, 160),
      upstreamCommit: String(upstreamCommit).slice(0, 80),
      sourceCommit: /^[a-f0-9]{40}$/i.test(environment.VERCEL_GIT_COMMIT_SHA || '') ? environment.VERCEL_GIT_COMMIT_SHA : null,
    };
  } catch {
    fallback.sourceCommit = /^[a-f0-9]{40}$/i.test(environment.VERCEL_GIT_COMMIT_SHA || '') ? environment.VERCEL_GIT_COMMIT_SHA : null;
    return fallback;
  }
}

function canaryExistedAtBoot(statePath, marker) {
  return readFileBounded(statePath).then(bytes => {
    const state = JSON.parse(bytes.toString('utf8'));
    validateSnapshotBytes('state', bytes);
    return state.memoryProposals.some(item => typeof item.content === 'string' && item.content.includes(marker));
  }).catch(() => false);
}

async function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function performLlmSmoke({ port, status, fetchImpl = fetch }) {
  const smoke = status.llm.smoke;
  smoke.enabled = true;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/llm/chat`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Reply with exactly: T3MP3ST_OK',
        systemPrompt: 'Return only the requested marker.',
        maxTokens: 32,
        tools: [],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    smoke.status = response.status;
    let body;
    try { body = await response.json(); }
    catch { body = null; }
    if (!response.ok) {
      if (Number.isSafeInteger(body?.upstreamStatus) && body.upstreamStatus >= 100 && body.upstreamStatus <= 599) {
        smoke.upstreamStatus = body.upstreamStatus;
      }
      if (typeof body?.upstreamCode === 'string' && /^[a-z_]{1,60}$/.test(body.upstreamCode)) {
        smoke.upstreamCode = body.upstreamCode;
      }
      if (typeof body?.upstreamParam === 'string' && /^[a-z_]{1,60}$/.test(body.upstreamParam)) {
        smoke.upstreamParam = body.upstreamParam;
      }
    }
    smoke.marker = response.ok && typeof body?.response === 'string' && body.response.trim() === 'T3MP3ST_OK';
    smoke.ok = smoke.marker;
    smoke.complete = true;
    if (!smoke.ok) {
      status.llm.ready = false;
      status.llm.error = response.ok ? 'smoke_marker_mismatch' : `smoke_http_${response.status}`;
    }
    return smoke.ok;
  } catch (error) {
    smoke.complete = true;
    smoke.ok = false;
    status.llm.ready = false;
    status.llm.error = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'smoke_timeout' : 'smoke_unavailable';
    return false;
  }
}

async function runCanary({ marker, port, status, statePath, persistence, fetchImpl = fetch }) {
  if (!marker) return;
  const content = `Deployment persistence verification: ${marker}`;
  status.canary.existedAtBoot = await canaryExistedAtBoot(statePath, marker);
  try {
    const collection = await fetchImpl(`http://127.0.0.1:${port}/api/memory/proposals`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!collection.ok) throw new Error('canary_lookup_failed');
    const body = await collection.json();
    const existing = Array.isArray(body?.proposals)
      ? body.proposals.find(item => typeof item.content === 'string' && item.content.includes(marker))
      : null;
    let proposal = existing;
    if (!proposal && !status.canary.existedAtBoot && !status.readOnly) {
      const created = await fetchImpl(`http://127.0.0.1:${port}/api/memory/proposals`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'open_question', content, source: 'production-audit' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!created.ok) throw new Error('canary_create_failed');
      proposal = await created.json();
      // The upstream state snapshot is debounced by one second.
      await wait(1_250);
      await persistence.flush();
      status.canary.syncedAt = new Date().toISOString();
    }
    status.canary.markerPresent = Boolean(proposal);
    status.canary.createdId = typeof proposal?.id === 'string' ? proposal.id : null;
    status.canary.contentHash = typeof proposal?.content === 'string' ? sha256(Buffer.from(proposal.content)) : null;
    status.canary.revision = persistence.revision;
  } catch (error) {
    status.canary.markerPresent = false;
    status.canary.error = error?.category || 'canary_unavailable';
  }
}

export async function runSupervisor({ environment = process.env, fetchImpl = fetch, blobSdk, spawnImpl = spawn, writeStatusImpl = writeRuntimeStatus } = {}) {
  let requestedSignal = null;
  let resolveSignal;
  let shutdownHandler;
  const signalPromise = new Promise(resolve => { resolveSignal = resolve; });
  const receiveSignal = signal => {
    requestedSignal = signal;
    resolveSignal(signal);
    if (shutdownHandler) void shutdownHandler(signal);
  };
  const onSigterm = () => receiveSignal('SIGTERM');
  const onSigint = () => receiveSignal('SIGINT');
  const removeSignalHandlers = () => {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
  };
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);

  const bootId = randomUUID();
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID || null;
  const canaryMarker = environment.T3MP3ST_AUDIT_CANARY || '';
  const smokeEnabled = environment.T3MP3ST_RUN_SMOKE === 'true';
  const readOnlyMode = environment.T3MP3ST_READ_ONLY === 'true';
  let stateDir;
  let configDir;
  let appConfigDir;
  let statusPath;
  let statusFailureShutdownTriggered = false;
  let status = createRuntimeStatus({
    deploymentId,
    bootId,
    canaryEnabled: Boolean(canaryMarker),
    smokeEnabled,
    release: await loadReleaseMetadata(environment),
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
  });
  const statusWrites = createRuntimeStatusQueue({
    getPath: () => statusPath,
    status,
    write: writeStatusImpl,
    onFailure: () => {
      status.ready = false;
      status.readOnly = true;
      status.persistence.readOnly = true;
      log('runtime_status.write_failed');
      if (statusPath) void rm(statusPath, { force: true }).catch(() => {});
      if (activeChild && shutdownRuntime && !statusFailureShutdownTriggered) {
        statusFailureShutdownTriggered = true;
        void shutdownRuntime('SIGTERM').catch(() => {});
      }
    },
  });
  const persistStatus = () => statusWrites.enqueue();
  const persistStatusNow = async () => {
    await statusWrites.enqueue();
    await statusWrites.flush();
  };
  let activePersistence = null;
  let activeChild = null;
  let shutdownRuntime = null;

  try {
    if (!environment.BLOB_READ_WRITE_TOKEN) throw new Error('blob_token_missing');
    stateDir = requireDirectory(environment.T3MP3ST_STATE_DIR, '/tmp/t3mp3st-state', 'state');
    configDir = requireDirectory(environment.T3MP3ST_CONFIG_DIR, '/tmp/t3mp3st-config', 'config');
    appConfigDir = join(configDir, 'runtime');
    statusPath = join(stateDir, 'runtime-status.json');
    const port = portFromEnvironment(environment);
    const epoch = writerEpochFromEnvironment(environment);
    const prefix = environment.T3MP3ST_BLOB_PREFIX || 't3mp3st-runtime';
    const token = environment.BLOB_READ_WRITE_TOKEN;
    const runtimeHome = join(stateDir, 'home');
    await Promise.all([
      mkdir(stateDir, { recursive: true, mode: 0o700 }),
      mkdir(appConfigDir, { recursive: true, mode: 0o700 }),
      mkdir(runtimeHome, { recursive: true, mode: 0o700 }),
    ]);
    // This reserved app config directory is created by the supervisor and never imports a legacy .env.
    await rm(join(appConfigDir, '.env'), { force: true });

    const sdk = blobSdk || await import('@vercel/blob');
    const adapter = createBlobAdapter({ get: sdk.get, put: sdk.put, token, timeoutMs: 10_000, fetchImpl });
    const fileMap = buildSnapshotFileMap(stateDir, appConfigDir);
    let persistence;
    persistence = new SnapshotPersistence({
      adapter,
      prefix,
      legacyPrefix: environment.T3MP3ST_LEGACY_BLOB_PREFIX || 't3mp3st-runtime/v1',
      fileMap,
      ownerId: `${deploymentId || 'local'}:${process.pid}:${bootId}`,
      epoch,
      environment,
      onStatus: update => {
        setPersistenceStatus(status, update);
        void persistStatus();
      },
      onPrivateReadCheck: check => {
        status.persistence.privateReadCheck = check;
        void persistStatus();
      },
      readOnly: readOnlyMode,
    });
    activePersistence = persistence;

    const restored = await persistence.restore();
    status.restoredFiles = restored.restoredFiles;
    status.restoredAt = new Date().toISOString();
    status.legacyUnchanged = restored.legacyUnchanged;
    status.legacyDigests = restored.legacyDigests;
    log('persistence.restored', { files: restored.restoredFiles.length, revision: restored.revision });
    if (requestedSignal) { await persistStatusNow(); removeSignalHandlers(); return 0; }

    const llm = await resolveOpenAIModel({ environment, fetchImpl });
    status.llm = {
      ...status.llm,
      ready: llm.ready,
      provider: 'openai',
      model: llm.model,
      checkedAt: llm.checkedAt,
      error: llm.error,
      fallbackUsed: llm.fallbackUsed,
    };
    const configPath = fileMap['config/config.json'];
    let restoredConfig = {};
    try {
      const rawConfig = await readFileBounded(configPath);
      restoredConfig = JSON.parse(sanitizeSnapshotBytes('config', rawConfig, persistence.exactSecrets).toString('utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const runtimeConfig = buildRuntimeConfig(llm, environment, restoredConfig);
    await writeRuntimeConfig(configPath, runtimeConfig);
    if (requestedSignal) { await persistStatusNow(); removeSignalHandlers(); return 0; }

    await persistence.recheckLegacy();
    if (!persistence.legacyUnchanged && !readOnlyMode) {
      const error = new Error('legacy_changed_during_migration');
      error.category = 'legacy_changed_during_migration';
      throw error;
    }
    if (requestedSignal) { await persistStatusNow(); removeSignalHandlers(); return 0; }
    const lease = readOnlyMode ? false : await persistence.claim();
    status.ready = true;
    status.readOnly = !lease;
    setPersistenceStatus(status, {
      revision: persistence.revision,
      readOnly: persistence.readOnly,
      persistenceReady: lease,
      leaseExpiresAt: persistence.leaseExpiresAt,
      lastSyncAt: persistence.lastSyncAt,
      legacyUnchanged: persistence.legacyUnchanged,
      legacyDigests: persistence.legacyDigests,
    });
    await persistStatusNow();
    log(lease ? 'persistence.writer_ready' : 'persistence.read_only', { revision: persistence.revision, epoch });
    if (requestedSignal) {
      await persistence.flush();
      await persistence.releaseLease();
      await persistStatusNow();
      removeSignalHandlers();
      return 0;
    }

    const childEnvironment = buildChildEnvironment(environment, {
      stateDir,
      configDir: appConfigDir,
      port,
    });
    childEnvironment.HOME = runtimeHome;
    const child = spawnImpl(process.execPath, ['/app/dist/server.js'], {
      cwd: '/app',
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      env: childEnvironment,
    });
    activeChild = child;
    let childSpawnError = false;
    child.once('error', () => { childSpawnError = true; });
    child.once('error', () => { child.spawnError = true; });

    let syncTimer;
    let legacyTimer;
    let shutdownPromise;
    const stopScheduling = () => {
      if (syncTimer) clearInterval(syncTimer);
      if (legacyTimer) clearInterval(legacyTimer);
    };
    const killGroup = signal => {
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, signal); } catch { /* Child may already be gone. */ }
      } else {
        try { child.kill(signal); } catch { /* Child may already be gone. */ }
      }
    };
    const beginShutdown = signal => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = shutdownChildAndFlush({
        stopScheduling,
        child,
        signal,
        closeTimeoutMs: 10_000,
        killProcessGroup: killGroup,
        flush: () => readOnlyMode ? Promise.resolve(false) : persistence.flush(),
        releaseLease: () => readOnlyMode || persistence.readOnly ? Promise.resolve(false) : persistence.releaseLease(),
      });
      return shutdownPromise;
    };

    shutdownHandler = signal => beginShutdown(signal);
    shutdownRuntime = beginShutdown;
    if (requestedSignal) void beginShutdown(requestedSignal);

    const childExit = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    syncTimer = setInterval(() => {
      if (persistence.readOnly) return;
      void persistence.sync().then(() => persistStatusNow()).catch(error => {
        persistence.reportStatus();
        setStatusError(status, error?.category || 'persistence_sync_failed');
        if (persistence.readOnly) status.readOnly = true;
        void persistStatus();
        log(error?.category === 'writer_fenced' ? 'persistence.fenced' : 'persistence.sync_failed');
      });
    }, 5_000);
    syncTimer.unref();
    legacyTimer = setInterval(() => {
      void persistence.recheckLegacy().then(() => persistStatusNow()).catch(error => {
        setStatusError(status, error?.category || 'legacy_recheck_failed');
        void persistStatus();
      });
    }, 30_000);
    legacyTimer.unref();

    try {
      const healthPath = persistence.readOnly ? '/api/llm/status' : '/api/health';
      const healthStatus = await waitForHttpReady({
        url: `http://127.0.0.1:${port}${healthPath}`,
        fetchImpl,
        child,
        timeoutMs: 20_000,
      });
      log('child.ready', { status: healthStatus });
    } catch (error) {
      setStatusError(status, childSpawnError ? 'child_spawn_failed' : 'child_readiness_failed');
      await persistStatusNow();
      await beginShutdown(requestedSignal || 'SIGTERM');
      removeSignalHandlers();
      return 1;
    }

    if (smokeEnabled) {
      await performLlmSmoke({ port, status, fetchImpl });
      await persistStatusNow();
      log('llm.smoke_complete', { status: status.llm.smoke.status, marker: status.llm.smoke.marker, model: status.llm.model });
    }
    if (canaryMarker) {
      await runCanary({ marker: canaryMarker, port, status, statePath: fileMap['state/state.json'], persistence, fetchImpl });
      await persistStatusNow();
      log('canary.complete', { present: status.canary.markerPresent, revision: status.canary.revision });
    }

    const first = await Promise.race([
      childExit.then(result => ({ kind: 'exit', result })),
      signalPromise.then(signal => ({ kind: 'signal', signal })),
    ]);
    let result;
    if (first.kind === 'signal') result = await beginShutdown(first.signal);
    else result = await beginShutdown(null);
    removeSignalHandlers();
    const naturalExitCode = first.kind === 'exit'
      ? (first.result.code == null ? (first.result.signal ? 1 : 0) : first.result.code)
      : 0;
    const successful = result.successful && !statusFailureShutdownTriggered;
    const exitCode = successful ? naturalExitCode : 1;
    log('shutdown.complete', { successful, exitCode, revision: persistence.revision });
    await persistStatusNow();
    return exitCode;
  } catch (error) {
    const category = typeof error?.category === 'string' ? error.category : 'startup_failed';
    setStatusError(status, category);
    status.ready = false;
    status.readOnly = true;
    try { await persistStatusNow(); } catch { /* Startup status is best-effort when storage paths are unavailable. */ }
    log('startup.failed', { category: status.lastError?.category || 'startup_failed' });
    try {
      if (shutdownRuntime) await shutdownRuntime(requestedSignal || 'SIGTERM');
      else if (activeChild || (activePersistence && !activePersistence.readOnly)) {
        const killGroup = signal => {
          if (activeChild?.pid && process.platform !== 'win32') {
            try { process.kill(-activeChild.pid, signal); } catch { /* Child may already be gone. */ }
          } else if (activeChild) {
            try { activeChild.kill(signal); } catch { /* Child may already be gone. */ }
          }
        };
        await shutdownChildAndFlush({
          child: activeChild,
          signal: requestedSignal || 'SIGTERM',
          killProcessGroup: killGroup,
          flush: () => readOnlyMode ? Promise.resolve(false) : activePersistence?.flush(),
          releaseLease: () => readOnlyMode || activePersistence?.readOnly ? Promise.resolve(false) : activePersistence?.releaseLease(),
        });
      }
    } catch { /* Cleanup errors are reported only through sanitized exit status. */ }
    try { await persistStatusNow(); } catch { /* Final status is best-effort during failure cleanup. */ }
    removeSignalHandlers();
    return 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runSupervisor().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
