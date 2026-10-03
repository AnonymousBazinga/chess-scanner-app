"""Freeze pixel-only pipeline intermediates before ablation. No labels in inference."""
import hashlib,json,sys,os
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(os.environ.get('SCANNER_SOURCE',ROOT/'web'))
sys.path.insert(0,str(SOURCE))
from scanner_backend import recognizer as runtime
import torch
DATA=ROOT/'web/qa/out/vision-evaluation-20261002'
OUT=DATA/'simplification';OUT.mkdir(exist_ok=True)

def cases():
    rows=[{'id':f'photo{i}','path':str(DATA/(f'images/image-{i}.jpg' if i<3 else f'new-image-{i}/original.png')),'group':'diagnostic'} for i in range(1,8)]
    for group,manifest in [('prior24','holdout-manifest.json'),('prior12','confirmation-manifest.json')]:
        for item in json.loads((DATA/'chess-priors'/manifest).read_text()):
            rows.append({'id':item['id'],'path':str(Path(item['path']) if 'path' in item else DATA/'chess-priors/holdout'/item['image']),'group':group})
    return rows

if __name__=='__main__':
    manifest=json.loads((OUT/'reserved-manifest.json').read_text()) if '--reserved' in sys.argv else cases()
    if '--reserved' not in sys.argv:(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
    frozen={'web/'+str(p.relative_to(SOURCE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (SOURCE/'scanner_backend').glob('*.py')}
    code_file=OUT/'baseline-code.json'
    if code_file.exists():assert json.loads(code_file.read_text())==frozen,'Baseline implementation changed'
    else:code_file.write_text(json.dumps(frozen,indent=2))
    original_infer=runtime.infer
    captured={}
    def capture(posteriors,objects):
        captured.update(posteriors=posteriors,objects=objects)
        return original_infer(posteriors,objects)
    runtime.infer=capture
    model=runtime.StructuredRecognizer(ROOT/'web/scanner_backend/weights');torch.set_num_threads(4)
    for row in manifest:
        target=OUT/(row['id']+'.json')
        if target.exists():continue
        image=ImageOps.exif_transpose(Image.open(row['path'])).convert('RGB')
        image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
        result=model.predict(image)
        np.savez_compressed(OUT/(row['id']+'.npz'),**captured['posteriors'])
        target.write_text(json.dumps({'case':row,'input_sha256':hashlib.sha256(Path(row['path']).read_bytes()).hexdigest(),'size':image.size,'objects':captured['objects'],'baseline':result},indent=2))
        print(row['id'],result['seconds'],result['geometry']['status'],flush=True)
