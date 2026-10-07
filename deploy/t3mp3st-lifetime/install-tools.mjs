import { readFile, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || '/usr/local/bin');
await mkdir(target, { recursive: true });
const specs = JSON.parse(await readFile(join(folder, 'tool-binaries.json'), 'utf8'));
for (const tool of specs) {
  const parsed = new URL(tool.url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !/^[a-z]+$/.test(tool.name)) throw new Error('Invalid tool source');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Tool download HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== tool.sha256) throw new Error('Tool checksum mismatch');
  const archive = join(target, `${tool.name}.tar.gz`);
  await writeFile(archive, data, { mode: 0o600 });
  execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', target, tool.name]);
  await chmod(join(target, tool.name), 0o755);
  await rm(archive);
  console.log(JSON.stringify({ event: 'tool.installed', tool: tool.name, version: tool.version, checksumVerified: true }));
}
