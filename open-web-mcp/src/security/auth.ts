import { timingSafeEqual } from 'node:crypto';
import { AuthenticationError } from '../errors/index.js';

function equalSecret(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export function verifyBearer(header: string | undefined, expected: string | undefined, required: boolean) {
  if (!expected && !required) return;
  if (!expected) throw new AuthenticationError('Server authentication is not configured');
  if (!header?.startsWith('Bearer ')) throw new AuthenticationError();
  if (!equalSecret(header.slice(7), expected)) throw new AuthenticationError();
}
