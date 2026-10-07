"""Report locations only, never matched secret values."""
import json
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
rules = {
    'openai-key': r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}',
    'github-token': r'\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{24,}',
    'blob-token': r'\bvercel_blob_rw_[A-Za-z0-9_-]{20,}',
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
}
findings = []
files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
for name in filter(None, files):
    path = root / name
    if not path.is_file():
        continue
    content = path.read_text(errors='ignore')
    for rule, pattern in rules.items():
        for match in re.finditer(pattern, content):
            findings.append({'file': name, 'line': content.count('\n', 0, match.start()) + 1, 'rule': rule})
print(json.dumps({'secretValuesPrinted': False, 'findings': findings}))
sys.exit(bool(findings))
