# Arsenal review

Baseline: 75 cataloged adapters, 8 installed. Keep existing tools; add only five defensive/local analysis binaries. No additional active scanner or catalog-only dangerous tool is installed. Runtime controls and receipts remain mandatory.

| Adapter | Classification | Execution policy | Decision |
|---|---|---|---|
| file | local_read | safe_command | Retain existing binary |
| curl | active | receipt_required | Retain existing binary |
| dig | passive | receipt_required | Retain existing binary |
| host | passive | receipt_required | Retain existing binary |
| whois | passive | receipt_required | Retain existing binary |
| nmap | active | receipt_required | Retain existing binary |
| subfinder | passive | receipt_required | Leave cataloged; not installed |
| httpx | active | receipt_required | Leave cataloged; not installed |
| naabu | active | receipt_required | Leave cataloged; not installed |
| katana | active | receipt_required | Leave cataloged; not installed |
| nuclei | active | receipt_required | Leave cataloged; not installed |
| ffuf | active | receipt_required | Leave cataloged; not installed |
| gobuster | active | receipt_required | Leave cataloged; not installed |
| arjun | active | receipt_required | Leave cataloged; not installed |
| feroxbuster | active | receipt_required | Leave cataloged; not installed |
| nikto | active | receipt_required | Leave cataloged; not installed |
| wpscan | active | receipt_required | Leave cataloged; not installed |
| dalfox | active | receipt_required | Leave cataloged; not installed |
| sqlmap | intrusive | receipt_required | Leave cataloged; not installed |
| semgrep | local_read | safe_command | Leave cataloged; not installed |
| gitleaks | local_read | safe_command | Install defensive local analysis binary |
| trufflehog | local_read | safe_command | Leave cataloged; not installed |
| trivy | local_read | safe_command | Install defensive local analysis binary |
| syft | local_read | safe_command | Leave cataloged; not installed |
| grype | local_read | safe_command | Leave cataloged; not installed |
| osv-scanner | local_read | safe_command | Leave cataloged; not installed |
| checkov | local_read | safe_command | Leave cataloged; not installed |
| prowler | active | receipt_required | Leave cataloged; not installed |
| scoutsuite | active | receipt_required | Leave cataloged; not installed |
| cloudfox | active | receipt_required | Leave cataloged; not installed |
| pmapper | active | receipt_required | Leave cataloged; not installed |
| pacu | dangerous | catalog_only | Leave cataloged; not installed |
| aws-cli | active | receipt_required | Leave cataloged; not installed |
| az-cli | active | receipt_required | Leave cataloged; not installed |
| gcloud-cli | active | receipt_required | Leave cataloged; not installed |
| garak | active | receipt_required | Leave cataloged; not installed |
| promptfoo | active | receipt_required | Leave cataloged; not installed |
| slither | local_read | safe_command | Leave cataloged; not installed |
| mythril | local_read | safe_command | Leave cataloged; not installed |
| echidna | local_read | safe_command | Leave cataloged; not installed |
| foundry-forge | local_read | safe_command | Leave cataloged; not installed |
| foundry-cast | active | receipt_required | Leave cataloged; not installed |
| solhint | local_read | safe_command | Leave cataloged; not installed |
| openssl | local_read | safe_command | Retain existing binary |
| john | credential | receipt_required | Leave cataloged; not installed |
| hashcat | credential | receipt_required | Leave cataloged; not installed |
| radamsa | local_read | safe_command | Leave cataloged; not installed |
| afl-fuzz | local_read | safe_command | Leave cataloged; not installed |
| radare2 | local_read | safe_command | Leave cataloged; not installed |
| ghidra | local_read | safe_command | Leave cataloged; not installed |
| objdump | local_read | safe_command | Leave cataloged; not installed |
| gdb | active | receipt_required | Leave cataloged; not installed |
| checksec | local_read | safe_command | Leave cataloged; not installed |
| strings | local_read | safe_command | Retain existing binary |
| readelf | local_read | safe_command | Install defensive local analysis binary |
| apktool | local_read | safe_command | Leave cataloged; not installed |
| jadx | local_read | safe_command | Leave cataloged; not installed |
| apkleaks | local_read | safe_command | Leave cataloged; not installed |
| mobsfscan | local_read | safe_command | Leave cataloged; not installed |
| objection | intrusive | receipt_required | Leave cataloged; not installed |
| frida | dangerous | catalog_only | Leave cataloged; not installed |
| drozer | intrusive | receipt_required | Leave cataloged; not installed |
| class-dump | local_read | safe_command | Leave cataloged; not installed |
| exiftool | local_read | safe_command | Install defensive local analysis binary |
| binwalk | local_read | safe_command | Leave cataloged; not installed |
| metasploit | dangerous | catalog_only | Leave cataloged; not installed |
| hydra | credential | catalog_only | Leave cataloged; not installed |
| bloodhound | credential | import_only | Leave cataloged; not installed |
| yara | local_read | safe_command | Install defensive local analysis binary |
| whatweb | active | receipt_required | Leave cataloged; not installed |
| wafw00f | passive | safe_command | Leave cataloged; not installed |
| amass | passive | receipt_required | Leave cataloged; not installed |
| dnsx | passive | safe_command | Leave cataloged; not installed |
| testssl | active | safe_command | Leave cataloged; not installed |
| waybackurls | passive | safe_command | Leave cataloged; not installed |

Semgrep is deferred because its Python/musl footprint and installed adapter behavior have not been validated for this runtime. Subfinder, httpx, katana, nuclei, ffuf and other active network additions remain uninstalled. Existing scoped recon remains available; generic remote command execution is limited to local version checks. Catalog entries do not imply executable access. Gitleaks reads source to identify exposed secrets; subprocesses receive no provider or storage credentials.
