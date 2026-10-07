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
for (const finding of findings) {
  console.log(JSON.stringify({ event: 'container.audit.finding', ...finding, blocking: blocking.includes(finding) }));
}
console.log(JSON.stringify({ event: 'container.audit.summary', count: findings.length, blocking: blocking.length }));
if (blocking.length) process.exit(1);
