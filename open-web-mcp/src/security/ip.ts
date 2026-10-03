import ipaddr from 'ipaddr.js';

const blockedRanges = new Set([
  'unspecified','broadcast','multicast','linkLocal','loopback','private','reserved','carrierGradeNat','uniqueLocal','ipv4Mapped'
]);

export function isPublicIp(input: string): boolean {
  try {
    let addr = ipaddr.parse(input);
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
    return !blockedRanges.has(addr.range());
  } catch {
    return false;
  }
}
