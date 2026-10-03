import { describe, expect, it } from 'vitest';
import { isPublicIp } from '../src/security/ip.js';

describe('isPublicIp', () => {
  it('blocks private and special addresses', () => {
    for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','::1','fc00::1','fe80::1']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });
  it('allows public addresses', () => {
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
  });
});
