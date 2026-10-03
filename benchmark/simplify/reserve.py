"""Reserve disjoint CVChess positions before choosing a simplification."""
import concurrent.futures,json,random,sys
from pathlib import Path
import gdown
from collect import DATA,OUT
catalog=Path(sys.argv[1]);labels_path=Path(sys.argv[2])
labels=json.loads(labels_path.read_text());files={r['path']:r['id'] for r in json.loads(catalog.read_text())}
used={r['gt_fen'].split()[0] for r in json.loads((DATA/'chess-priors/holdout-labels.json').read_text())}
used.update(r['truth'].split()[0] for r in json.loads((DATA/'chess-priors/confirmation-results.json').read_text())['records'])
groups={}
for row in labels:
    if row['image'] in files and row['gt_fen'].split()[0] not in used:groups.setdefault(row['gt_fen'].split()[0],[]).append(row)
rng=random.Random(20261004)
selected=[rng.choice(groups[key]) for key in rng.sample(sorted(groups),24)]
manifest=[{'id':Path(r['image']).stem,'path':str(OUT/'reserved'/r['image']),'group':'reserved24'} for r in selected]
(OUT/'reserved').mkdir(exist_ok=True)
for name,rows in [('reserved-manifest.json',manifest),('reserved-labels.json',selected)]:
    dest=OUT/name
    if dest.exists():assert json.loads(dest.read_text())==rows,'Never replace a frozen reservation'
    else:dest.write_text(json.dumps(rows,indent=2))
print('Reserved 24 positions disjoint from the prior 36, seed 20261004, before viewing ablation results.',flush=True)
def download(row):
    dest=Path(row['path'])
    if not dest.exists():gdown.download(id=files[dest.name],output=str(dest),use_cookies=False,quiet=True)
    print(dest.name,dest.stat().st_size,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,manifest))
