import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve('public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_SIGNING = process.env.PUBLIC_SIGNING === '1';
const SIGNER_TOKEN = process.env.SIGNER_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const MAX_BODY = 1_000_000;
const RATE_WINDOW = 60_000;
const RATE_LIMIT = Number(process.env.SIGN_RATE_LIMIT || 12);
const rate = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function json(res, code, body) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.host === req.headers.host;
  } catch { return false; }
}

function signerAllowed(req) {
  if (SIGNER_TOKEN) {
    const supplied = req.headers['x-signer-token'];
    if (supplied && Buffer.byteLength(String(supplied)) === Buffer.byteLength(SIGNER_TOKEN) && crypto.timingSafeEqual(Buffer.from(String(supplied)), Buffer.from(SIGNER_TOKEN))) return true;
  }
  const ip = clientIp(req);
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local || (PUBLIC_SIGNING && sameOrigin(req));
}

function limited(req) {
  const key = clientIp(req);
  const now = Date.now();
  const item = rate.get(key);
  if (!item || now - item.start > RATE_WINDOW) {
    rate.set(key, {start: now, count: 1});
    return false;
  }
  item.count += 1;
  return item.count > RATE_LIMIT;
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function safeName(input='Shortcut') {
  return input.normalize('NFKC').replace(/[\\/:*?\"<>|\u0000-\u001F]/g, '-').trim().slice(0, 80) || 'Shortcut';
}

async function signShortcut({name, plist}) {
  if (process.platform !== 'darwin') throw new Error('SIGNING_REQUIRES_MACOS');
  if (typeof plist !== 'string' || !plist.includes('<plist') || !plist.includes('WFWorkflowActions')) throw new Error('INVALID_PLIST');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shortcut-forge-'));
  const clean = safeName(name);
  const xml = path.join(dir, `${clean}.plist`);
  const unsigned = path.join(dir, `${clean}.shortcut`);
  const signed = path.join(dir, `${clean}-signed.shortcut`);
  try {
    await writeFile(xml, plist, 'utf8');
    await execFileAsync('/usr/bin/plutil', ['-lint', xml]);
    await execFileAsync('/usr/bin/plutil', ['-convert', 'binary1', '-o', unsigned, xml]);
    await execFileAsync('/usr/bin/shortcuts', ['sign', '--mode', 'anyone', '--input', unsigned, '--output', signed], {timeout: 60_000});
    const data = await readFile(signed);
    return {data, filename: `${clean}.shortcut`};
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
}

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT)) return json(res, 403, {error:'forbidden'});
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not_file');
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': pathname === '/index.html' ? 'no-cache' : 'public, max-age=300'
    });
    createReadStream(file).pipe(res);
  } catch {
    if (!path.extname(pathname)) {
      const index = path.join(ROOT, 'index.html');
      res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});
      return createReadStream(index).pipe(res);
    }
    json(res, 404, {error:'not_found'});
  }
}

const server = http.createServer(async (req, res) => {
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
    res.setHeader('vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'access-control-allow-methods':'POST,GET,OPTIONS','access-control-allow-headers':'content-type,x-signer-token'});
    return res.end();
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      platform: process.platform,
      signingAvailable: process.platform === 'darwin',
      publicSigning: PUBLIC_SIGNING,
      protectedByToken: Boolean(SIGNER_TOKEN)
    });
  }

  if (req.url === '/api/sign' && req.method === 'POST') {
    if (limited(req)) return json(res, 429, {error:'rate_limited'});
    if (!signerAllowed(req)) return json(res, 403, {error:'signing_not_allowed'});
    try {
      const body = JSON.parse(await readBody(req));
      const result = await signShortcut(body);
      res.writeHead(200, {
        'content-type':'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        'cache-control':'no-store'
      });
      return res.end(result.data);
    } catch (error) {
      const code = error.message === 'SIGNING_REQUIRES_MACOS' ? 503 : 400;
      return json(res, code, {error:error.message || 'sign_failed'});
    }
  }

  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Shortcut Forge: http://${HOST}:${PORT}`);
  console.log(`Signing: ${process.platform === 'darwin' ? 'macOS available' : 'disabled (requires macOS)'}`);
});
