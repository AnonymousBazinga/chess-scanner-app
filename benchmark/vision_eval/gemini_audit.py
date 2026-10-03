"""Reproducible vision audit, original pixels, photo-relative grid, no labels in prompts.

Preserves endpoint, settings, input hashes, visible answer and usage. Secrets are
read with getpass and never serialized. Previous experiment artifacts stay frozen.
"""
import argparse
import base64
import getpass
import hashlib
import json
import time
from pathlib import Path
import requests
from run_openrouter import DEFAULT_OUT, extract

OUT = DEFAULT_OUT / 'llm-audit'
PROMPT = '''Transcribe the physical chessboard in the attached photo. Return the grid exactly as viewed in the photo, without rotating to either player's perspective and ignoring printed letters/numbers. The top-left playing square is row 0 column 0; bottom-right is row 7 column 7. Locate each piece by its BASE where it touches the board, not its head or shadow. Ignore watermarks and all content outside the 8x8 playing area. Do not assume a starting position, legal position or expected number of pieces. Return JSON {"ranks":[eight strings of eight characters],"uncertain_squares":["row,column"],"notes":"brief visual ambiguities"}. Use . for empty; uppercase PNBRQK for light pawn/knight/bishop/rook/queen/king and lowercase pnbrqk for dark pieces. Each string describes one visible row, left to right, starting with the top row. Identify shape and color from the image.'''

def source(i):
    return DEFAULT_OUT / ('images/image-%d.jpg' % i if i <= 2 else 'new-image-%d/original.png' % i)

def request(key, model, image_paths, prompt, endpoint, target):
    if target.exists():
        return json.loads(target.read_text())
    image_data=[]
    provenance=[]
    for path in image_paths:
        raw=path.read_bytes()
        mime='image/png' if path.suffix=='.png' else 'image/jpeg'
        image_data.append((mime,base64.b64encode(raw).decode()))
        provenance.append({'path':str(path.relative_to(DEFAULT_OUT)), 'sha256':hashlib.sha256(raw).hexdigest()})
    config={'temperature':1,'max_output_tokens':32768,'thinking_level':'high'}
    if endpoint=='interactions':
        inputs=[{'type':'text','text':prompt}]
        for mime,data in image_data:
            item={'type':'image','mime_type':mime,'data':data}
            if not model.startswith('gemini-2'):item['resolution']='high'
            inputs.append(item)
        payload={'model':model,'input':inputs,'generation_config':config,'store':False}
        url='https://generativelanguage.googleapis.com/v1beta/interactions'
    else:
        config={'temperature':1,'maxOutputTokens':32768,'responseMimeType':'application/json'}
        config['thinkingConfig']={'thinkingBudget':24576} if model.startswith('gemini-2') else {'thinkingLevel':'high'}
        if not model.startswith('gemini-2'):config['mediaResolution']='MEDIA_RESOLUTION_HIGH'
        parts=[{'text':prompt}]+[{'inlineData':{'mimeType':mime,'data':data}} for mime,data in image_data]
        payload={'contents':[{'role':'user','parts':parts}],'generationConfig':config}
        url=f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    row={'model':model,'endpoint':endpoint,'input':provenance,'prompt':prompt,'settings':config,'resolution':'high','status':'pending'}
    t=time.monotonic()
    try:
        r=requests.post(url,headers={'x-goog-api-key':key},json=payload,timeout=(15,240))
        row['http_status']=r.status_code
        body=r.json()
        if r.status_code!=200:
            row.update(status='http_error',error=body.get('error',body))
        else:
            row['usage']=body.get('usage',body.get('usageMetadata'))
            row['model_returned']=body.get('model',body.get('modelVersion'))
            if endpoint=='interactions':
                row['finish_reason']=body.get('status')
                content=body.get('output_text') or ''.join(x.get('text','') for x in body.get('outputs',[]) if x.get('type')=='text')
                row['response_keys']=list(body)
            else:
                candidate=body.get('candidates',[{}])[0]
                row['finish_reason']=candidate.get('finishReason')
                content=''.join(p.get('text','') for p in candidate.get('content',{}).get('parts',[]) if not p.get('thought'))
            row['content']=content
            row['status']='answered'
            try:row.update(placement=extract(content),status='ok')
            except ValueError:pass
    except Exception as exc:
        row.update(status='error',error=type(exc).__name__+': '+str(exc))
    row['seconds']=round(time.monotonic()-t,3)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(row,indent=2)+'\n')
    return row

def main():
    p=argparse.ArgumentParser();p.add_argument('--models',nargs='+',required=True);p.add_argument('--images',nargs='+',type=int,default=[1,2,3,4,5,6]);p.add_argument('--endpoint',choices=['interactions','generate'],default='interactions');p.add_argument('--round',default='whole-r1');args=p.parse_args()
    key=getpass.getpass('Gemini key (hidden, memory only): ')
    for model in args.models:
        for i in args.images:
            row=request(key,model,[source(i)],PROMPT,args.endpoint,OUT/f'{model}-{args.endpoint}-image{i}-{args.round}.json')
            print(json.dumps({'image':i,**{k:row.get(k) for k in ['model','status','http_status','seconds','placement','error']}}),flush=True)
            if row.get('http_status') in (400,403,404):break

if __name__=='__main__':main()
