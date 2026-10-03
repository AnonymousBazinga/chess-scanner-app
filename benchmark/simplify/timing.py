"""Paired, sequential warm inference timing; run without other model jobs."""
import importlib,json,statistics,sys,time,types
from pathlib import Path
from PIL import Image,ImageOps
import torch
from collect import ROOT,OUT
# Supply a git-extracted baseline web/scanner_backend directory.
module=types.ModuleType('baseline_scanner');module.__path__=[sys.argv[1]]
sys.modules[module.__name__]=module
old_class=importlib.import_module('baseline_scanner.recognizer').StructuredRecognizer
from scanner_backend.recognizer import StructuredRecognizer
manifest={row['id']:row for row in json.loads((OUT/'manifest.json').read_text())}
ids=['photo4','photo7','IMG_6295','IMG_6433','IMG_6495','IMG_6572']
models={'baseline':old_class(ROOT/'web/scanner_backend/weights'),'pruned':StructuredRecognizer(ROOT/'web/scanner_backend/weights')}
torch.set_num_threads(4)
images={}
for ident in ids:
    image=ImageOps.exif_transpose(Image.open(manifest[ident]['path'])).convert('RGB');image.thumbnail((2048,2048),Image.Resampling.LANCZOS);images[ident]=image
for model in models.values():model.predict(images['photo7'])
rows=[]
for repeat in range(3):
    for ident in ids:
        row={'id':ident,'repeat':repeat}
        for name in (['baseline','pruned'] if repeat%2==0 else ['pruned','baseline']):
            start=time.monotonic();result=models[name].predict(images[ident]);row[name]=time.monotonic()-start
            assert result['placement']==json.loads((OUT/(ident+'.json')).read_text())['baseline']['placement']
        rows.append(row);print(json.dumps(row),flush=True)
        (OUT/'timing.json').write_text(json.dumps(rows,indent=2))
print('Medians by case',json.dumps({ident:{name:statistics.median(r[name] for r in rows if r['id']==ident) for name in models} for ident in ids}),flush=True)
