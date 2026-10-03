import { describe, expect, it } from 'vitest';
import { validatePublicUrl } from '../src/security/url-validator.js';
import { BlockedAddressError, InvalidUrlError } from '../src/errors/index.js';

describe('validatePublicUrl', () => {
  it('rejects unsupported protocols', async () => {
    await expect(validatePublicUrl('file:///etc/passwd')).rejects.toBeInstanceOf(InvalidUrlError);
    await expect(validatePublicUrl('ftp://example.com/a')).rejects.toBeInstanceOf(InvalidUrlError);
  });
  it('rejects loopback and metadata IPs', async () => {
    await expect(validatePublicUrl('http://127.0.0.1')).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(validatePublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(validatePublicUrl('http://[::1]/')).rejects.toBeInstanceOf(BlockedAddressError);
  });
});
