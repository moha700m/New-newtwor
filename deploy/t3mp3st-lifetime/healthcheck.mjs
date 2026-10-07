const port = process.env.PORT || process.env.T3MP3ST_PORT || '3000';
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
  const body = await response.json();
  if (!response.ok || !body.ok || !body.storage?.ok) process.exit(1);
} catch { process.exit(1); }
