"""Direct-provider evaluation. Keys remain in process memory, never in outputs."""
import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import time
import requests
from run_openrouter import DEFAULT_OUT, PROMPT, SQUARES, expand, extract, score

OUT=DEFAULT_OUT/'followup'
def fen_from_map(pieces):
    if any(k not in SQUARES or v not in 'PNBRQKpnbrqk' or len(v)!=1 for k,v in pieces.items()):
        raise ValueError('Invalid square/piece mapping')
    return '/'.join(re.sub(r'\.+',lambda m:str(len(m.group())),''.join(pieces.get(s,'.') for s in SQUARES[i:i+8])) for i in range(0,64,8))

def parse_object(content):
    content=re.sub(r'^```(?:json)?\s*|\s*```$','',content.strip())
    return json.loads(content[content.index('{'):content.rindex('}')+1])

def build_prompt(image,mode):
    base=PROMPT[:PROMPT.index('Return a JSON')]
    if mode=='occupancy':
        baseline=json.loads((DEFAULT_OUT/'local-fenify-3D.json').read_text())[image-1]
        occupied=[s for s,p in zip(SQUARES,expand(baseline['placement'])) if p!='.']
        base+='\nA separate detector found occupied squares: '+', '.join(occupied)+'. Identify the color and type of the piece whose BASE is on EACH listed square. Do not change occupancy. The detector supplies no piece identity.\n'
    else:occupied=None
    base+='Return JSON with "pieces": an object mapping each occupied algebraic square to a single FEN piece symbol (PNBRQK white; pnbrqk black), and "uncertain_squares": an array. Do not compress into FEN ranks. Omit empty squares. Distinguish carved bishops, kings and queens from pawns by shape. Never repair a visually unusual position using assumptions about legal chess.'
    return base,occupied

def run(provider,model,index,mode,key,repeat=1):
    OUT.mkdir(exist_ok=True)
    name=f'{provider}-{model.replace("/","_")}-image{index}-{mode}-r{repeat}'
    target=OUT/(name+'.json')
    if target.exists():return
    raw=(DEFAULT_OUT/'images'/f'image-{index}.jpg').read_bytes()
    prompt,occupied=build_prompt(index,mode)
    row={'model':model,'provider':provider,'image':index,'mode':mode,'repeat':repeat,'prompt':prompt,'image_sha256':hashlib.sha256(raw).hexdigest()}
    start=time.monotonic()
    try:
        if provider=='gemini':
            payload={'contents':[{'role':'user','parts':[{'text':prompt},{'inlineData':{'mimeType':'image/jpeg','data':base64.b64encode(raw).decode()}}]}],'generationConfig':{'temperature':0,'maxOutputTokens':16384,'responseMimeType':'application/json'}}
            r=requests.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',headers={'x-goog-api-key':key},json=payload,timeout=(15,180))
        else:
            payload={'model':model,'image_url':'data:image/jpeg;base64,'+base64.b64encode(raw).decode(),'question':prompt}
            r=requests.post('https://api.moondream.ai/v1/query',headers={'X-Moondream-Auth':key},json=payload,timeout=(15,180))
        row['http_status']=r.status_code
        body=r.json()
        if r.status_code!=200:
            row.update(status='http_error',error=body.get('error',body))
        else:
            if provider=='gemini':
                row['usage']=body.get('usageMetadata')
                candidate=body.get('candidates',[{}])[0]
                row['finish_reason']=candidate.get('finishReason')
                content=''.join(p.get('text','') for p in candidate.get('content',{}).get('parts',[]) if not p.get('thought'))
            else:
                row['usage']=body.get('metrics');content=body.get('answer','')
            row['content']=content
            obj=parse_object(content)
            placement=fen_from_map(obj['pieces'])
            if occupied is not None and set(obj['pieces'])!=set(occupied):
                raise ValueError('Provider did not preserve detector occupancy')
            row.update(status='ok',placement=placement,score=score(placement,index),uncertain_squares=obj.get('uncertain_squares',[]))
    except Exception as exc:row.update(status='error',error=type(exc).__name__+': '+str(exc))
    row['seconds']=round(time.monotonic()-start,3)
    target.write_text(json.dumps(row,indent=2)+'\n')
    print(json.dumps({k:row.get(k) for k in ['model','image','mode','status','seconds','score','error']}),flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('provider',choices=['gemini','moondream']);p.add_argument('--key-stdin',action='store_true');p.add_argument('--models',nargs='+');p.add_argument('--modes',nargs='+',default=['whole','occupancy']);p.add_argument('--repeat',type=int,default=1);args=p.parse_args()
    key=getpass.getpass('API key (hidden, memory only): ') if args.key_stdin else os.environ[{'gemini':'GEMINI_API_KEY','moondream':'MOONDREAM_API_KEY'}[args.provider]]
    OUT.mkdir(exist_ok=True)
    if args.provider=='gemini':
        res=requests.get('https://generativelanguage.googleapis.com/v1beta/models',headers={'x-goog-api-key':key},timeout=30)
        catalog=res.json()
        if res.status_code!=200:
            print('Model catalog rejected:',res.status_code,catalog.get('error',{}).get('message'));return
        (OUT/'gemini-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
        print('Available vision candidates:',[m['name'] for m in catalog.get('models',[]) if 'flash' in m['name']],flush=True)
    models=args.models or (['gemini-3.8-flash','gemini-2.5-flash'] if args.provider=='gemini' else ['moondream3.1-9B-A2B'])
    for model in models:
        for mode in args.modes:
            for index in (1,2):run(args.provider,model,index,mode,key,args.repeat)

if __name__=='__main__':main()
