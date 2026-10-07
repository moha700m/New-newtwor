function closeChild(child, timeoutMs) {
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve({ code: child.exitCode, signal: child.signalCode || null, timedOut: false });
  if (child.signalCode) return Promise.resolve({ code: child.exitCode ?? null, signal: child.signalCode, timedOut: false });
  return new Promise(resolve => {
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
      resolve(result);
    };
    const onClose = (code, signal) => finish({ code, signal, timedOut: false });
    const onError = () => finish({ code: null, signal: null, timedOut: false, spawnError: true });
    const timer = setTimeout(() => finish({ code: null, signal: null, timedOut: true }), timeoutMs);
    child.once('close', onClose);
    child.once('error', onError);
  });
}

export async function shutdownChildAndFlush({
  stopScheduling,
  child,
  signal,
  closeTimeoutMs = 10_000,
  closeChildImpl = closeChild,
  killProcessGroup = () => {},
  flush,
  releaseLease,
}) {
  stopScheduling?.();
  let childResult = { code: null, signal: null, timedOut: false };
  if (child && child.exitCode == null && child.signalCode == null) {
    const closed = closeChildImpl(child, closeTimeoutMs);
    if (signal) {
      try { child.kill(signal); } catch { /* Child may have closed while the signal was being sent. */ }
    }
    childResult = await closed;
    if (childResult.timedOut) {
      killProcessGroup('SIGKILL');
      childResult = await closeChildImpl(child, 1_000);
      childResult.timedOut = true;
    }
  }

  let flushError;
  try { await flush(); }
  catch (error) { flushError = error; }

  let releaseError;
  if (!flushError) {
    try { await releaseLease?.(); }
    catch (error) { releaseError = error; }
  }

  return {
    childResult,
    flushError,
    releaseError,
    successful: !childResult.timedOut && !childResult.spawnError
      && !(childResult.code != null && childResult.code !== 0)
      && !(childResult.signal && childResult.signal !== signal)
      && !flushError && !releaseError,
  };
}

export async function waitForHttpReady({
  url,
  fetchImpl = fetch,
  child,
  timeoutMs = 20_000,
  intervalMs = 200,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('child_exited_before_ready');
    if (child?.spawnError) throw new Error('child_spawn_failed');
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response.status;
    } catch {
      // Readiness polling deliberately exposes only a status to the caller.
    }
    await sleep(intervalMs);
  }
  throw new Error('child_readiness_timeout');
}

export async function waitForChildCloseOrTimeout(child, timeoutMs = 10_000) {
  return closeChild(child, timeoutMs);
}
