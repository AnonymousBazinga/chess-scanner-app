"""Reproducible model assets and an explicit public-files allowlist."""
from pathlib import Path
import hashlib
import json
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
weights = ROOT / 'scanner_backend' / 'weights'
weights.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / 'scanner_backend' / 'models.json').read_text())
for entry in manifest:
    dest = weights / entry['name']
    if not dest.exists():
        if entry.get('local'):
            shutil.copyfile(ROOT / entry['local'], dest)
        else:
            print('Fetching', entry['name'], flush=True)
            with urllib.request.urlopen(entry['url'], timeout=120) as src, dest.open('wb') as out:
                shutil.copyfileobj(src, out)
    digest = hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest()
    if digest != entry['sha256']:
        dest.unlink()
        raise RuntimeError('Model hash mismatch: ' + entry['name'])

public = ROOT / 'public'
public.mkdir(exist_ok=True)
for name in ('index.html', 'styles.css', 'manifest.webmanifest', 'icon-1024.png', 'js', 'pieces', 'vendor', 'licenses'):
    src = ROOT / name
    if src.is_dir(): shutil.copytree(src, public / name, dirs_exist_ok=True)
    else: shutil.copyfile(src, public / name)
print('Static files and verified model assets ready.', flush=True)
