import json,numpy as np
from pathlib import Path
from chess_constraints import infer,CHARS
from hybrid import placement
from run_openrouter import DEFAULT_OUT,expand
root=DEFAULT_OUT/'chess-priors'
manifest=json.loads((root/'holdout-manifest.json').read_text())
# Generate and serialize EVERY prediction before the labels are read.
outputs=[]
for item in manifest:
 probs=dict(np.load(root/'posteriors'/(item['id']+'.npz')));g=json.loads((root/(item['id']+'-geometry.json')).read_text())
 try:
  b,m,_=infer(probs,g['objects']);pred={'joint':b.tolist(),'fenify':probs['fenify_0'].argmax(-1).ravel().tolist(),'v4':probs['v4_0'].argmax(-1).ravel().tolist(),'vitl':probs['vitl_0'].argmax(-1).ravel().tolist()};error=None
 except ValueError as exc:pred={};m={};error=str(exc)
 outputs.append({'id':item['id'],'predictions':pred,'details':m,'error':error})
 print(item['id'],'predicted',flush=True)
(root/'holdout-predictions.json').write_text(json.dumps(outputs,indent=2)+'\n')
labels={Path(r['image']).stem:r['gt_fen'].split()[0] for r in json.loads((root/'holdout-labels.json').read_text())}
summary={k:{'wrong':0,'exact':0,'raw_exact':0,'boards':0} for k in ('joint','fenify','v4','vitl')}
for r in outputs:
 truth=np.array([CHARS.index(p) for p in expand(labels[r['id']])]).reshape(8,8);r['scores']={};r['truth']=labels[r['id']]
 for name,b in r['predictions'].items():
  board=np.array(b).reshape(8,8);errors=[int(np.sum(np.rot90(board,k)!=truth)) for k in range(4)];k=int(np.argmin(errors))
  r['scores'][name]={'wrong':errors[k],'display_rotation_ccw':k*90,'raw_wrong':errors[0],'placement':placement(np.array(list(CHARS))[b])};s=summary[name];s['wrong']+=errors[k];s['exact']+=errors[k]==0;s['raw_exact']+=errors[0]==0;s['boards']+=1
(root/'holdout-results.json').write_text(json.dumps({'summary':summary,'records':outputs},indent=2)+'\n');print(json.dumps(summary,indent=2))
