import dns from 'node:dns/promises';
import net from 'node:net';
import { BlockedAddressError, InvalidUrlError } from '../errors/index.js';
import { isPublicIp } from './ip.js';

export interface ResolvedPublicUrl { url: URL; addresses: string[]; }

export async function validatePublicUrl(input: string): Promise<ResolvedPublicUrl> {
  let url: URL;
  try { url = new URL(input); } catch { throw new InvalidUrlError('Malformed URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new InvalidUrlError(`Unsupported protocol: ${url.protocol}`);
  if (url.username || url.password) throw new InvalidUrlError('Credentials in URLs are not allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new BlockedAddressError('localhost is blocked');
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new BlockedAddressError(`Blocked IP: ${host}`);
    return { url, addresses: [host] };
  }
  let records: dns.LookupAddress[];
  try { records = await dns.lookup(host, { all: true, verbatim: true }); }
  catch { throw new InvalidUrlError(`DNS resolution failed for ${host}`); }
  if (records.length === 0) throw new InvalidUrlError(`No DNS addresses for ${host}`);
  const addresses = records.map((r) => r.address);
  if (addresses.some((ip) => !isPublicIp(ip))) throw new BlockedAddressError(`Host ${host} resolves to a blocked address`);
  return { url, addresses };
}
