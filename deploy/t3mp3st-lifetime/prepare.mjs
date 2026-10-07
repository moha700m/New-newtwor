import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const overlay = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || '/app');
export const upstreamCommit = '29824d5625ede419ac8cdae418c8f4c72c6270f7';
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim();
if (actual !== upstreamCommit) throw new Error('Unreviewed upstream commit: build refused');
const patch = join(overlay, 'patches', 'hosted-runtime.patch');
execFileSync('git', ['apply', '--check', patch], { cwd: target, stdio: 'inherit' });
execFileSync('git', ['apply', patch], { cwd: target, stdio: 'inherit' });
for (const name of ['package.json', 'package-lock.json']) await copyFile(join(overlay, name), join(target, name));
await writeFile(join(target, 'release.json'), await readFile(join(overlay, 'release.json')));
console.log(JSON.stringify({ event: 'source.prepared', upstreamCommit }));
