import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || '/opt/binaries/gitleaks');
const sourceCommit = '83d9cd684c87d95d656c1458ef04895a7f1cbd8e';
const sourceUrl = 'https://github.com/gitleaks/gitleaks.git';
const goUrl = 'https://dl.google.com/go/go1.26.8.linux-amd64.tar.gz';
const goSha256 = 'd0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b';
const workDir = await mkdtemp('/tmp/t3mp3st-gitleaks-build-');
const archive = join(workDir, 'go.tar.gz');

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

try {
  const response = await fetch(goUrl, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Go toolchain download failed: HTTP ${response.status}`);
  const archiveBytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(archiveBytes).digest('hex');
  if (digest !== goSha256) throw new Error('Go toolchain archive checksum mismatch');
  await writeFile(archive, archiveBytes, { mode: 0o600 });
  await mkdir(join(workDir, 'toolchain'), { recursive: true });
  run('tar', ['-xzf', archive, '-C', join(workDir, 'toolchain')]);
  const go = join(workDir, 'toolchain', 'go', 'bin', 'go');
  const goVersion = execFileSync(go, ['version'], { encoding: 'utf8' }).trim();
  if (!goVersion.includes('go1.26.8')) throw new Error(`Unexpected Go toolchain version: ${goVersion}`);

  const sourceDir = join(workDir, 'source');
  const gitEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, GIT_TERMINAL_PROMPT: '0' };
  run('git', ['clone', '--depth=1', '--filter=blob:none', '--branch', 'v8.30.1', '--no-checkout', sourceUrl, sourceDir], { env: gitEnv });
  run('git', ['-C', sourceDir, 'checkout', '--detach', sourceCommit], { env: gitEnv });
  const checkedOutCommit = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: gitEnv }).trim();
  if (checkedOutCommit !== sourceCommit) throw new Error('Gitleaks source commit verification failed');

  await copyFile(join(runtimeDir, 'gitleaks', 'go.mod'), join(sourceDir, 'go.mod'));
  await copyFile(join(runtimeDir, 'gitleaks', 'go.sum'), join(sourceDir, 'go.sum'));

  const goEnv = {
    PATH: `${dirname(go)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: join(workDir, 'home'),
    GOTOOLCHAIN: 'local',
    GOCACHE: join(workDir, 'cache'),
    GOMODCACHE: join(workDir, 'modules'),
    GOPROXY: 'https://proxy.golang.org,direct',
    GOSUMDB: 'sum.golang.org',
    CGO_ENABLED: '0',
    GOOS: 'linux',
    GOARCH: 'amd64',
  };
  await mkdir(goEnv.HOME, { recursive: true });
  run(go, ['test', '-mod=readonly', './...'], { cwd: sourceDir, env: goEnv });
  run(go, ['mod', 'verify'], { cwd: sourceDir, env: goEnv });
  const dependencies = execFileSync(go, ['list', '-deps', '-mod=readonly', '-f', '{{.ImportPath}}', '.'], {
    cwd: sourceDir, env: goEnv, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (/^golang\.org\/x\/crypto\/openpgp(?:\/|$)/m.test(dependencies)) {
    throw new Error('Deprecated x/crypto/openpgp package is linked into Gitleaks');
  }

  await mkdir(dirname(output), { recursive: true });
  run(go, [
    'build', '-mod=readonly', '-trimpath',
    '-ldflags=-s -w -X github.com/zricethezav/gitleaks/v8/version.Version=8.30.1',
    '-o', output, '.',
  ], { cwd: sourceDir, env: goEnv });
  await chmod(output, 0o755);
  const version = execFileSync(output, ['version'], { encoding: 'utf8' }).trim();
  if (version !== '8.30.1') throw new Error(`Unexpected Gitleaks binary version: ${version}`);
  console.log(JSON.stringify({ event: 'tool.built', tool: 'gitleaks', version, sourceCommit, goVersion: '1.26.8', cgo: false, deprecatedOpenpgpLinked: false }));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
