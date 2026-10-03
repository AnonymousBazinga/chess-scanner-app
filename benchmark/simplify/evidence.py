"""Export compact, shareable evidence without photos, weights, or credentials."""
import hashlib,json,statistics
from pathlib import Path
from collect import ROOT,OUT
from ablate import expand,references
refs=references()
for row in json.loads((OUT/'reserved-labels.json').read_text()):refs[Path(row['image']).stem]=list(expand(row['gt_fen']))
manifest=json.loads((OUT/'manifest.json').read_text())+json.loads((OUT/'reserved-manifest.json').read_text())
parity=[]
for row in json.loads((OUT/'step2.json').read_text()):
    ident=row['id'];saved=json.loads((OUT/(ident+'.json')).read_text());result=row['result']
    wrong=[i for i,(p,allowed) in enumerate(zip(expand(result['placement']),refs[ident])) if p not in allowed]
    parity.append({'id':ident,'group':row['group'],'input_sha256':saved['input_sha256'],'placement':result['placement'],'review_squares':result['review_squares'],'differences':row['differences'],'passes':row['passes'],'known_wrong_squares':['abcdefgh'[i%8]+str(8-i//8) for i in wrong]})
assert len(parity)==67 and all(not r['differences'] for r in parity)
step1=json.loads((OUT/'step1.json').read_text())
assert len(step1)==43 and all(not r['differences'] for r in step1)
ablations=json.loads((OUT/'ablations.json').read_text())
assert len(ablations)==43*17 and all('error' not in r for r in ablations)
result={'stage1_commit':'98fe3a4','baseline_commit':'6778e53','baseline_code_sha256':json.loads((OUT/'baseline-code.json').read_text()),'candidate_code_sha256':{'web/'+str(p.relative_to(ROOT/'web')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'web/scanner_backend').glob('*.py')},'protocol':{'discovery_boards':43,'reserved_boards':24,'reserved_seed':20261004,'reserved_positions_disjoint_from_prior_36':True,'comparison':'All predict() response fields except elapsed seconds; native orientation, no truth-selected rotations','limits':'Four diagnostic photos have partial identity labels. CVChess model training overlap is unknown. Identical output preserves existing mistakes. No latency claim from concurrent collection runs.'},'step1':{'boards':len(step1),'identical_full_responses':sum(not r['differences'] for r in step1)},'step2':{'boards':len(parity),'identical_full_responses':sum(not r['differences'] for r in parity),'neural_passes_before':9*len(parity),'neural_passes_after':sum(len(r['passes']) for r in parity),'fallback_boards':sum(len(r['passes'])==1 for r in parity)},'ablation_summary':json.loads((OUT/'summary.json').read_text()),'ablation_boards':[{k:v for k,v in r.items() if k!='seconds'} for r in json.loads((OUT/'ablations.json').read_text())],'parity_boards':parity}
if (OUT/'timing.json').exists():
    timing=json.loads((OUT/'timing.json').read_text());assert len(timing)==18
    result['warm_timing']={'threads':4,'rounds':3,'method':'Six fixed cases, paired sequential baseline/candidate scans, alternating execution order, after model warmup; local Mac, not hosted latency','median_seconds':{ident:{name:round(statistics.median(r[name] for r in timing if r['id']==ident),3) for name in ('baseline','pruned')} for ident in sorted(set(r['id'] for r in timing))}}
(ROOT/'benchmark/simplify/results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result['step2'],indent=2));print('Reserved known wrong squares',sum(len(r['known_wrong_squares']) for r in parity if r['group']=='reserved24'))
