import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_SNAPSHOT_BYTES } from './persistence-files.mjs';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

function safeModelId(value, fallback = DEFAULT_OPENAI_MODEL) {
  return typeof value === 'string' && MODEL_ID.test(value) ? value : fallback;
}

function fallbackModelsFromEnvironment(environment) {
  if (environment.T3MP3ST_OPENAI_ALLOW_FALLBACK !== 'true') return [];
  const raw = environment.T3MP3ST_OPENAI_FALLBACK_MODELS || '';
  const candidates = raw.split(',').map(item => item.trim()).filter(Boolean);
  if (candidates.some(item => !MODEL_ID.test(item))) return [];
  return [...new Set(candidates)];
}

export async function resolveOpenAIModel({ environment = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const requestedModel = environment.T3MP3ST_OPENAI_MODEL?.trim();
  const preferred = requestedModel ? safeModelId(requestedModel) : DEFAULT_OPENAI_MODEL;
  const checkedAt = new Date(now()).toISOString();
  if (requestedModel && !MODEL_ID.test(requestedModel)) {
    return { ready: false, provider: 'openai', model: DEFAULT_OPENAI_MODEL, checkedAt, error: 'invalid_preferred_model', fallbackUsed: false };
  }
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ready: false, provider: 'openai', model: preferred, checkedAt, error: 'missing_api_key', fallbackUsed: false };

  try {
    const response = await fetchImpl(OPENAI_MODELS_URL, {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ready: false, provider: 'openai', model: preferred, checkedAt, error: `model_list_http_${response.status}`, fallbackUsed: false };
    let body;
    try { body = await response.json(); }
    catch { return { ready: false, provider: 'openai', model: preferred, checkedAt, error: 'model_list_invalid_json', fallbackUsed: false }; }
    if (!Array.isArray(body?.data) || !body.data.every(item => item && typeof item.id === 'string')) {
      return { ready: false, provider: 'openai', model: preferred, checkedAt, error: 'model_list_invalid_schema', fallbackUsed: false };
    }
    const available = new Set(body.data.map(item => item.id));
    if (available.has(preferred)) return { ready: true, provider: 'openai', model: preferred, checkedAt, error: null, fallbackUsed: false };
    const selected = fallbackModelsFromEnvironment(environment).find(model => available.has(model));
    if (selected) return { ready: true, provider: 'openai', model: selected, checkedAt, error: null, fallbackUsed: true };
    return { ready: false, provider: 'openai', model: preferred, checkedAt, error: 'preferred_model_unavailable', fallbackUsed: false };
  } catch (error) {
    const errorCategory = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'model_list_timeout' : 'model_list_unavailable';
    return { ready: false, provider: 'openai', model: preferred, checkedAt, error: errorCategory, fallbackUsed: false };
  }
}

export function buildRuntimeConfig(llm, environment = process.env, restoredConfig = {}) {
  const rawTokens = environment.T3MP3ST_MAX_TOKENS || '1024';
  const requestedTokens = /^\d+$/.test(rawTokens) ? Number.parseInt(rawTokens, 10) : Number.NaN;
  const maxTokens = Number.isFinite(requestedTokens) && requestedTokens > 0 ? Math.min(requestedTokens, 1024) : 1024;
  const model = safeModelId(llm?.model);
  return {
    ...(restoredConfig && typeof restoredConfig === 'object' && !Array.isArray(restoredConfig) ? restoredConfig : {}),
    apiKeys: {},
    defaultProvider: 'openai',
    defaultModel: model,
    openai: {
      ...(restoredConfig?.openai && typeof restoredConfig.openai === 'object' && !Array.isArray(restoredConfig.openai) ? restoredConfig.openai : {}),
      baseUrl: OPENAI_BASE_URL,
      defaultModel: model,
    },
    maxTokens,
    timeout: 30_000,
    fallbackChain: [],
    proxyUrl: '',
  };
}

export async function writeRuntimeConfig(path, config) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const bytes = Buffer.from(JSON.stringify(config, null, 2));
    if (bytes.length > MAX_SNAPSHOT_BYTES) throw new Error('config_too_large');
    await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

const CHILD_ENV_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NODE_ENV', 'PORT', 'VERCEL_URL',
  'T3MP3ST_STATE_DIR', 'T3MP3ST_CONFIG_DIR', 'T3MP3ST_MODE', 'T3MP3ST_HOSTED',
  'T3MP3ST_HOST', 'T3MP3ST_PORT', 'T3MP3ST_OPENAI_MODEL',
  'T3MP3ST_OPENAI_ALLOW_FALLBACK', 'T3MP3ST_OPENAI_FALLBACK_MODELS', 'T3MP3ST_MAX_TOKENS',
  'TEMPEST_DEFAULT_PROVIDER', 'DOCKER',
]);

export function buildChildEnvironment(environment, { stateDir, configDir, port }) {
  const child = {};
  for (const key of CHILD_ENV_KEYS) {
    if (typeof environment[key] === 'string' && environment[key] !== '') child[key] = environment[key];
  }
  if (typeof environment.OPENAI_API_KEY === 'string' && environment.OPENAI_API_KEY) child.OPENAI_API_KEY = environment.OPENAI_API_KEY;
  child.T3MP3ST_STATE_DIR = stateDir;
  child.T3MP3ST_CONFIG_DIR = configDir;
  child.T3MP3ST_HOSTED = 'true';
  child.T3MP3ST_HOST = environment.T3MP3ST_HOST || '0.0.0.0';
  child.T3MP3ST_PORT = String(port);
  child.PORT = String(port);
  child.NODE_ENV = 'production';
  child.TEMPEST_DEFAULT_PROVIDER = 'openai';
  return child;
}

export function writerEpochFromEnvironment(environment = process.env) {
  const raw = environment.T3MP3ST_WRITER_EPOCH ?? '0';
  if (!/^\d+$/.test(raw)) throw new Error('invalid_writer_epoch');
  const epoch = Number(raw);
  if (!Number.isSafeInteger(epoch)) throw new Error('invalid_writer_epoch');
  return epoch;
}
