"""Single-factor removals; preserve baseline frames, report per-square regressions."""
import json,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'web'))
from scanner_backend.chess_constraints import decode,geometric_score,CHARS
from scanner_backend.recognizer import canonicalize
from scanner_backend.notation import placement
DATA=ROOT/'web/qa/out/vision-evaluation-20261002';OUT=DATA/'simplification'
VARIANTS={
 'baseline':{},
 'zero_cost_early_stop':{'early_stop':True},
 'no_vitl':{'groups':('fenify','v4')},
 'no_fenify':{'groups':('v4','vitl')},
 'v4_only':{'fallback':True},
 'v4_raw':{'fallback':True,'raw':True},
 'no_chess_constraints':{'raw':True},
 'no_detector_identity':{'alpha':0},
 'uniform_weights':{'uniform':True},
 'best_model_only':{'winner':True},
 'no_alignment_search':{'align':False},
 'fenify_single_view':{'fenify_rotations':(0,)},
 'v4_single_view':{'v4_rotations':(0,)},
 'both_single_view':{'fenify_rotations':(0,),'v4_rotations':(0,)},
 'no_inventory_penalty':{'strength':0},
 'no_occupancy_lock':{'lock':False},
 'single_decoder_orientation':{'axes':(0,)},
}

def run(data,objects,config):
    def solve(p):
        lock=config.get('lock',True) and 2<=np.sum(p.argmax(-1)!=0)<=32
        try:return decode(p,strength=config.get('strength',1),lock_occupancy=lock)
        except ValueError:return decode(p,strength=config.get('strength',1))
    if not objects or config.get('fallback'):
        p=data['v4_0'];board=p.argmax(-1).reshape(-1) if config.get('raw') else solve(p)[0]
        return board,{'fallback':True},p
    candidates=[];resolved=set()
    for name,p in data.items():
        group,rot=name.split('_');rot=int(rot)
        if config.get('early_stop') and group in resolved:continue
        if group not in config.get('groups',('fenify','v4','vitl')):continue
        if rot not in config.get(group+'_rotations',(0,1,2,3)):continue
        align=[0] if group=='fenify' or not config.get('align',True) else range(4)
        score,k,q=min((geometric_score(np.rot90(p,k),objects),k,np.rot90(p,k).copy()) for k in align)
        candidates.append({'name':name,'p':q,'geometry_cost':score,'align_ccw':k})
        if score==0:resolved.add(group)
    selected=[min((c for c in candidates if c['name'].startswith(g)),key=lambda c:c['geometry_cost']) for g in config.get('groups',('fenify','v4','vitl'))]
    costs=np.array([s['geometry_cost'] for s in selected]);weights=np.exp(-(costs-costs.min())/2);weights/=weights.sum()
    if config.get('uniform'):weights=np.ones(len(selected))/len(selected)
    if config.get('winner'):weights=np.eye(len(selected))[np.argmin(costs)]
    mix=sum(w*s['p'] for w,s in zip(weights,selected))
    for o in objects:
        r,c=divmod(o['index'],8);alpha=config.get('alpha',.35)*o['confidence'];evidence=np.full(13,.01);evidence[CHARS.index(o['piece'])]=.88
        mix[r,c]=(1-alpha)*mix[r,c]+alpha*evidence
    if config.get('raw'):board=mix.argmax(-1).ravel()
    else:
        candidates=[]
        for k in config.get('axes',(0,1)):
            b,meta=solve(np.rot90(mix,k));candidates.append((meta['objective'],np.rot90(b.reshape(8,8),-k).ravel()))
        board=min(candidates,key=lambda c:c[0])[1]
    details={'components':[{k:s[k] for k in ('name','align_ccw','geometry_cost')} for s in selected]}
    return board,details,mix

def expand(fen):return ''.join('.'*int(c) if c.isdigit() else c for c in fen.split()[0] if c!='/')

def references():
    result={}
    for row in json.loads((DATA/'llm-audit/results.json').read_text())['records']:
        result['photo'+str(row['id'])]=[row['reference'].get(f+r,'.') for r in '87654321' for f in 'abcdefgh']
    result['photo7']=list(expand('rnbqk1nr/ppp2ppp/4p3/3p4/1b6/P7/1PPPPPPP/RNBQKBNR'))
    for row in json.loads((DATA/'chess-priors/holdout-labels.json').read_text()):result[Path(row['image']).stem]=list(expand(row['gt_fen']))
    for row in json.loads((DATA/'chess-priors/confirmation-results.json').read_text())['records']:result[row['id']]=list(expand(row['truth']))
    return result

if __name__=='__main__':
    refs=references();manifest=json.loads((OUT/'manifest.json').read_text());records=[]
    if '--diagnostic' in sys.argv:manifest=[r for r in manifest if r['group']=='diagnostic']
    for case in manifest:
        ident=case['id'];saved=json.loads((OUT/(ident+'.json')).read_text());data=dict(np.load(OUT/(ident+'.npz')));objects=saved['objects']
        base=expand(saved['baseline']['placement']);truth=refs[ident]
        for name,config in VARIANTS.items():
            start=time.monotonic()
            try:
                board,details,mix=run(data,objects,config);board,_=canonicalize(board,details);pred=''.join(np.array(list(CHARS))[board])
                if name=='baseline':assert pred==base,(ident,pred,base)
                wrong=[i for i,(p,t) in enumerate(zip(pred,truth)) if p not in t];basewrong=[i for i,(p,t) in enumerate(zip(base,truth)) if p not in t]
                row={'id':ident,'group':case['group'],'variant':name,'placement':placement(pred),'changed_squares':[i for i,(p,b) in enumerate(zip(pred,base)) if p!=b],'wrong':wrong,'new_errors':sorted(set(wrong)-set(basewrong)),'fixed_errors':sorted(set(basewrong)-set(wrong)),'seconds':round(time.monotonic()-start,4)}
            except Exception as e:row={'id':ident,'variant':name,'error':str(e)}
            records.append(row)
        (OUT/'ablations.json').write_text(json.dumps(records,indent=2))
        print(ident,'complete',flush=True)
    summary=[]
    for name in VARIANTS:
        rows=[r for r in records if r['variant']==name];good=[r for r in rows if 'error' not in r]
        summary.append({'variant':name,'failures':len(rows)-len(good),'identical_boards':sum(not r['changed_squares'] for r in good),'changed_squares':sum(len(r['changed_squares']) for r in good),'known_errors':sum(len(r['wrong']) for r in good),'new_errors':sum(len(r['new_errors']) for r in good),'fixed_errors':sum(len(r['fixed_errors']) for r in good)})
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
