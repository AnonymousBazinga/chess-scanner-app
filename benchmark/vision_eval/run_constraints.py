import json,cv2,numpy as np
from gemini_audit import OUT
from chess_constraints import infer,decode,CHARS
from hybrid import placement
from audit_report import ROT,evaluate
from run_openrouter import DEFAULT_OUT
ROOT=DEFAULT_OUT/'chess-priors';ROOT.mkdir(exist_ok=True)
refs=json.loads((OUT/'results.json').read_text())['records']
for i in range(1,7):
    corners=json.loads((OUT/f'image{i}-auto-geometry.json').read_text())['corners'];h=cv2.getPerspectiveTransform(np.float32(corners),np.float32([[0,0],[8,0],[8,8],[0,8]]));objects=[]
    for o in json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces']:
        c,r=np.floor(cv2.perspectiveTransform(np.float32([[o['base']]]),h)[0,0]).astype(int)
        if 0<=r<8 and 0<=c<8:objects.append({**o,'index':int(r*8+c)})
    probs=dict(np.load(ROOT/f'posteriors/image{i}.npz'));board,meta,mix=infer(probs,objects)
    cases={'joint':(board,meta)}
    for key in ('fenify_0','v4_0'):
        p=probs[key];k=ROT[i] if key.startswith('fenify') else 0
        b,m=decode(np.rot90(p,k));b=np.rot90(b.reshape(8,8),-k).reshape(-1)
        cases[key+'-constraints']=(b,m)
    results={}
    for name,(b,m) in cases.items():
        chars=np.array(list(CHARS))[b];compare=chars.reshape(8,8)
        if name!='v4_0-constraints':compare=np.rot90(compare,ROT[i])
        results[name]={'placement':placement(chars),'details':m,'score':evaluate(compare.flatten().tolist(),refs[i-1]['reference'])}
    (ROOT/f'dev-image{i}.json').write_text(json.dumps(results,indent=2)+'\n')
    print(i,{k:v['score']['confirmed_mismatches'] for k,v in results.items()},meta['components'],flush=True)
