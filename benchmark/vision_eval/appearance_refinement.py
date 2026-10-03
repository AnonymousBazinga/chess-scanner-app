"""Ablation: visual nearest neighbors within a board share identity evidence."""
import json,cv2,numpy as np
from chess_constraints import infer,decode,CHARS
from gemini_audit import OUT
from run_openrouter import DEFAULT_OUT
from hybrid import placement
from audit_report import ROT,evaluate
root=DEFAULT_OUT/'chess-priors';refs=json.loads((OUT/'results.json').read_text())['records']
for i in range(1,7):
 raw=json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces'];features=np.load(root/f'image{i}-appearance.npy');h=cv2.getPerspectiveTransform(np.float32(json.loads((OUT/f'image{i}-auto-geometry.json').read_text())['corners']),np.float32([[0,0],[8,0],[8,8],[0,8]]));objects=[];indices=[]
 for n,o in enumerate(raw):
  c,r=np.floor(cv2.perspectiveTransform(np.float32([[o['base']]]),h)[0,0]).astype(int)
  if 0<=r<8 and 0<=c<8:objects.append({**o,'index':int(r*8+c)});indices.append(n)
 probs=dict(np.load(root/f'posteriors/image{i}.npz'));_,_,mix=infer(probs,objects);p=mix.reshape(64,13).copy();f=features[indices];similarity=f@f.T;links=[]
 for j,o in enumerate(objects):
  neighbors=[k for k in np.argsort(-similarity[j]) if k!=j and similarity[j,k]>.88 and objects[k]['piece'].isupper()==o['piece'].isupper()][:3]
  if not neighbors:continue
  q=np.mean([mix.reshape(64,13)[objects[k]['index']] for k in neighbors],axis=0)
  # Change identity only: preserve the local occupied/empty probability.
  q[0]=0;q=q/max(q.sum(),1e-6)*(1-p[o['index'],0]);q[0]=p[o['index'],0]
  p[o['index']]=.7*p[o['index']]+.3*q
  links.append({'object':indices[j],'neighbors':[indices[k] for k in neighbors],'cosines':[float(similarity[j,k]) for k in neighbors]})
 candidates=[]
 for k in (0,1):
  try:b,m=decode(np.rot90(p.reshape(8,8,13),k),lock_occupancy=True)
  except ValueError:continue
  candidates.append((m['objective'],np.rot90(b.reshape(8,8),-k).reshape(-1)))
 if not candidates:
  (root/f'appearance-image{i}.json').write_text(json.dumps({'error':'Appearance smoothing produced no feasible occupancy-locked board','links':links},indent=2));print(i,'infeasible',len(links),flush=True);continue
 _,b=min(candidates,key=lambda x:x[0]);chars=np.array(list(CHARS))[b];score=evaluate(np.rot90(chars.reshape(8,8),ROT[i]).flatten().tolist(),refs[i-1]['reference'])
 (root/f'appearance-image{i}.json').write_text(json.dumps({'placement':placement(chars),'links':links,'score':score},indent=2)+'\n');print(i,score['confirmed_mismatches'],len(links),flush=True)
