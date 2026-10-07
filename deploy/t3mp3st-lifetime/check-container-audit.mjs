import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(await readFile(join(base, 'container-audit.json'), 'utf8'));
const findings = (report.Results || []).flatMap(result => (result.Vulnerabilities || []).map(v => ({
  target: result.Target, id: v.VulnerabilityID, package: v.PkgName,
  installed: v.InstalledVersion, fixed: v.FixedVersion || null, severity: v.Severity,
})));
const blocking = findings.filter(v => ['HIGH', 'CRITICAL'].includes(v.severity) && v.fixed);
console.log(JSON.stringify({ event: 'container.audit', count: findings.length, blocking: blocking.length, findings }));
if (blocking.length) process.exit(1);
