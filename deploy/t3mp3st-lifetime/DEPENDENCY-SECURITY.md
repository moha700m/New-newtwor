# Dependency security review

Audit baseline: 13 affected packages (5 moderate, 7 high, 1 critical). Final npm audit: 0.

| Package | Severity | Before → after | Production | Advisories | Remediation and risk |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | high | 1.30.0 → 1.31.0 | Runtime dependency | GHSA-6qxp-vccf-f47h | Safe direct patch/minor; full regression suite |
| `@vitest/coverage-v8` | moderate | 4.1.9 → 4.1.11 | Build/test only; pruned from image | Inherited from Vitest | Safe direct patch/minor; full regression suite |
| `@vitest/mocker` | moderate | 4.1.9 → 4.1.11 | Build/test only; pruned from image | GHSA-82fw-gwwq-j7x9 | Safe lockfile refresh within existing range; full regression suite |
| `brace-expansion` | high | 1.1.18, 2.1.4 → 1.1.21, 2.1.7 | Build/test only; pruned from image | GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7 | Safe lockfile refresh within existing range; full regression suite |
| `fast-uri` | high | 3.1.6 → 3.1.8 | Runtime dependency | GHSA-58mr-gqgx-xq4g, GHSA-hrr3-gc8f-f4qj, GHSA-qw65-cvwx-89v3 | Safe lockfile refresh within existing range; full regression suite |
| `figlet` | high | 1.9.4 → 1.11.3 | Runtime dependency | GHSA-62ch-8vmq-8xm7 | Safe direct patch/minor; full regression suite |
| `hono` | moderate | 4.13.3 → 4.13.13 | Runtime dependency | GHSA-crvj-82cr-hjcx, GHSA-g6gw-c38x-mqfc, GHSA-gqvv-2mrq-wpjv, GHSA-hxh3-vqpv-xpqv | Safe lockfile refresh within existing range; full regression suite |
| `ip-address` | moderate | 10.5.0 → 10.7.3 | Runtime dependency | GHSA-2vr4-cq9g-pvrc, GHSA-h3mg-xc3c-68pw, GHSA-j6r3-76f7-8jcv, GHSA-rpw4-54j3-4h4q | Safe lockfile refresh within existing range; full regression suite |
| `js-yaml` | high | 4.3.1 → 4.3.2 | Build/test only; pruned from image | GHSA-2883-xcg3-v3hh | Safe lockfile refresh within existing range; full regression suite |
| `proxy-addr` | critical | 2.0.7 → 2.0.8 | Runtime dependency | GHSA-jqcg-44mw-7w3h | Safe lockfile refresh within existing range; full regression suite |
| `source-map-js` | high | 1.2.1 → 1.2.2 | Build/test only; pruned from image | GHSA-68fv-2mgg-jv7q | Safe lockfile refresh within existing range; full regression suite |
| `undici` | high | 8.10.0 → 8.10.2 | Runtime dependency | GHSA-2gqq-gqf2-x968, GHSA-2jfj-6hjv-fm6j, GHSA-3wwx-pv8p-q78v, GHSA-3xpg-4rpp-hhhm, GHSA-8436-99hf-9mmv, GHSA-pmjh-fq2x-6v4x, GHSA-r53p-7pc4-xj5r, GHSA-rfgv-xxqx-mfg5, GHSA-rx4f-c7p8-82vq, GHSA-vp8m-p9jh-q5pm, GHSA-w293-vg96-wgc3 | Safe direct patch/minor; full regression suite |
| `vitest` | moderate | 4.1.9 → 4.1.11 | Build/test only; pruned from image | GHSA-82fw-gwwq-j7x9 | Safe direct patch/minor; full regression suite |

The baseline audit JSON retains every exact installed dependency path, vulnerable range, severity, and advisory URL. The final audit JSON records the empty vulnerability set. The lockfile retains the previously tested Vite/rolldown/lightningcss versions rather than introducing incidental upgrades.

Package installation uses `npm ci --ignore-scripts`; the optional esbuild binary resolves without running its install script. No dependency install scripts are blanket-approved. Registry signature/provenance verification is recorded separately.

`dependency-paths.json` records the installed dependency graph and parent requirements for each repaired package, including transitive chains. The baseline paths and versions are retained in `dependency-audit-before.json`; the reproducible lockfile fixes the resulting versions. Every change stays within the current major version and was verified against clean installation and the full test suite. No forced audit remediation or cross-major upgrade was used.
