"""Pixel-level candidate replay; compare all response fields except elapsed time."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
from collect import ROOT,DATA,OUT
from scanner_backend.recognizer import StructuredRecognizer
import torch
name=sys.argv[1]
manifest=json.loads((OUT/'manifest.json').read_text())
if '--reserved' in sys.argv:manifest+=json.loads((OUT/'reserved-manifest.json').read_text())
records=[]
model=StructuredRecognizer(ROOT/'web/scanner_backend/weights');torch.set_num_threads(4)
original_probabilities=model.probabilities
calls={}
def probabilities(*args,**kwargs):
    result=original_probabilities(*args,**kwargs);calls['passes']=list(result)
    return result
model.probabilities=probabilities
for case in manifest:
    ident=case['id'];baseline=json.loads((OUT/(ident+'.json')).read_text())['baseline']
    image=ImageOps.exif_transpose(Image.open(case['path'])).convert('RGB');image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
    result=model.predict(image)
    differences=[key for key in set(baseline)|set(result) if key!='seconds' and baseline.get(key)!=result.get(key)]
    records.append({'id':ident,'group':case['group'],'differences':differences,'passes':calls['passes'],'baseline_seconds':baseline['seconds'],'result':result})
    (OUT/(name+'.json')).write_text(json.dumps(records,indent=2))
    print(ident, result['seconds'], len(calls['passes']), differences,flush=True)
print('IDENTICAL RESPONSES',sum(not r['differences'] for r in records),'/',len(records),flush=True)
assert all(not r['differences'] for r in records),'Candidate changed the response'
