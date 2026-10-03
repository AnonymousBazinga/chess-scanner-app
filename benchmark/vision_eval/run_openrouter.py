"""Compare currently free, general-purpose vision endpoints on fixed photos.

OPENROUTER_API_KEY is read from the environment, never written to artifacts.
Raw outputs are retained separately from scores; no ground truth enters prompts.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / 'web/qa/out/vision-evaluation-20261002'
PROMPT = '''Read the physical chessboard in this image and transcribe the piece placement.
Use the actual base of each piece to determine its square, not where its head appears.
Ignore watermarks, website controls, shadows, and pieces outside the playing grid.
For this evaluation, a8 is the top-left playing square as seen in the image and h1 is the bottom-right; do not rotate the board. Use visible coordinates when present.
Inspect all 64 squares. Do not assume a standard starting position, a legal position, or missing pieces from chess knowledge. Identify what is visibly present.
Return a JSON object with "placement" (only the piece-placement field of FEN, ranks 8 to 1, files a to h; uppercase white and lowercase black), "uncertain_squares" (array of square names), and "notes" (brief visual ambiguities only).'''
SQUARES = [f+str(r) for r in range(8, 0, -1) for f in 'abcdefgh']
REQUEST_CODE = '''import json,os,sys,urllib.request,urllib.error
payload = sys.stdin.buffer.read()
request = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',data=payload,headers={'Authorization':'Bearer '+os.environ['OPENROUTER_API_KEY'],'Content-Type':'application/json','X-Title':'Chess Scanner Vision Evaluation'})
try:
    with urllib.request.urlopen(request,timeout=240) as response:
        print(json.dumps({'body':json.load(response)}))
except urllib.error.HTTPError as exc:
    print(json.dumps({'http_status':exc.code,'error':exc.read().decode()[:3000]}))
'''

def expand(placement):
    rows = placement.split()[0].split('/')
    if len(rows) != 8:
        raise ValueError('Expected eight ranks')
    board = []
    for row in rows:
        cells = []
        for c in row:
            if c in '12345678': cells.extend('.' * int(c))
            elif c in 'PNBRQKpnbrqk': cells.append(c)
            else: raise ValueError('Invalid piece')
        if len(cells) != 8: raise ValueError('Invalid rank length')
        board.extend(cells)
    return board

def score(placement, index):
    board = expand(placement)
    old = json.loads((ROOT/'web/qa/out/accuracy-investigation/baseline-comparison.json').read_text())
    truth = expand(old['image2_manual_truth']) if index == 2 else None
    occupied = set(old['image1_occupied_squares']) if index == 1 else {s for s,p in zip(SQUARES,truth) if p != '.'}
    result = {'occupancy_errors': sum((s in occupied) != (p != '.') for s,p in zip(SQUARES,board)), 'predicted_pieces':sum(p != '.' for p in board)}
    if truth:
        result['wrong_squares'] = sum(a != b for a,b in zip(truth,board))
        result['exact_placement'] = result['wrong_squares'] == 0
        result['errors'] = [{'square':s,'expected':a,'predicted':b} for s,a,b in zip(SQUARES,truth,board) if a != b]
    return result

def extract(content):
    grid = re.search(r'"ranks"\s*:\s*(\[[\s\S]*?\])', content)
    if grid:
        rows = json.loads(grid[1])
        if len(rows) != 8 or any(not isinstance(r,str) or len(r)!=8 or re.search(r'[^.PNBRQKpnbrqk]',r) for r in rows):
            raise ValueError('Grid must contain eight strings of eight pieces/empty cells')
        placement = '/'.join(re.sub(r'\.+',lambda m:str(len(m.group())),r) for r in rows)
        expand(placement)
        return placement
    match = re.search(r'"placement"\s*:\s*"([^"\n]+)"', content)
    if match:
        expand(match[1]); return match[1].split()[0]
    for candidate in re.findall(r'[prnbqkPRNBQK1-8]+(?:/[prnbqkPRNBQK1-8]+){7}', content):
        try: expand(candidate); return candidate
        except ValueError: pass
    raise ValueError('No valid placement in model response')

def run(model, index, trial, args, key):
    slug = model.replace('/','__').replace(':','_')
    target = args.out/'responses'/f'{slug}-image{index}-trial{trial}.json'
    if target.exists(): return json.loads(target.read_text())
    raw_image = (args.out/'images'/f'image-{index}.jpg').read_bytes()
    prompt = PROMPT
    if args.format == 'grid':
        prompt = PROMPT[:PROMPT.index('Return a JSON')] + 'Return JSON with "ranks": an array of exactly eight strings, each exactly eight characters, one per square. Order the strings from rank 8 down to rank 1, and characters from file a to h. Use . for empty, PNBRQK for white pawn/knight/bishop/rook/queen/king, pnbrqk for black. Do not use digits or compressed FEN. Also include "uncertain_squares" as an array. Check all eight rows have exactly eight characters before answering.'
    payload = {'model':model, 'messages':[{'role':'user','content':[
        {'type':'text','text':prompt},
        {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(raw_image).decode(),'detail':'high'}}]}],
        'temperature':0, 'max_tokens':8192, 'provider':{'max_price':{'prompt':0,'completion':0}}}
    if args.reasoning:
        payload['reasoning'] = {'effort':args.reasoning, 'exclude':True}
    payload['max_tokens'] = args.max_tokens
    if args.structured:
        payload['response_format'] = {'type':'json_schema','json_schema':{'name':'chess_grid','strict':True,'schema':{'type':'object','properties':{'ranks':{'type':'array','minItems':8,'maxItems':8,'items':{'type':'string','pattern':'^[.PNBRQKpnbrqk]{8}$'}},'uncertain_squares':{'type':'array','items':{'type':'string'}}},'required':['ranks','uncertain_squares'],'additionalProperties':False}}}
    row = {'model':model,'image':index,'trial':trial,'image_sha256':hashlib.sha256(raw_image).hexdigest(),'request_settings':{'temperature':0,'max_tokens':8192,'detail':'high','max_price':{'prompt':0,'completion':0}}}
    row['request_settings']['max_tokens'] = args.max_tokens
    row['request_settings']['reasoning'] = payload.get('reasoning')
    row['request_settings']['format'] = args.format
    row['request_settings']['structured'] = args.structured
    row['prompt'] = prompt
    start = time.monotonic()
    try:
        # A socket timeout alone can hang on server keep-alives. A child process
        # enforces the full wall-time deadline and is killed/reaped on expiry.
        child_env = dict(os.environ, OPENROUTER_API_KEY=key)
        child = subprocess.run([sys.executable,'-c',REQUEST_CODE],input=json.dumps(payload),capture_output=True,text=True,env=child_env,timeout=240,check=True)
        result = json.loads(child.stdout)
        if 'http_status' in result:
            row.update(status='http_error',**result)
            raise HTTPRecorded()
        body = result['body']
        # Keep visible answer, usage, provider and completion status, not private reasoning.
        row['response'] = {k:body.get(k) for k in ['id','model','provider','usage','error']}
        choice = body.get('choices',[{}])[0]
        row['finish_reason'] = choice.get('finish_reason')
        content = choice.get('message',{}).get('content') or ''
        row['content'] = content
        row['placement'] = extract(content)
        row['score'] = score(row['placement'],index)
        row['status'] = 'ok'
    except HTTPRecorded:
        pass
    except subprocess.TimeoutExpired:
        row.update(status='timeout',error='Request exceeded 240 second wall-time limit')
    except Exception as exc:
        row.update(status='error',error=str(exc))
    row['seconds'] = round(time.monotonic()-start,3)
    target.write_text(json.dumps(row,indent=2)+'\n')
    print(json.dumps({k:row.get(k) for k in ['model','image','trial','status','seconds','score','error']}),flush=True)
    return row

class HTTPRecorded(Exception):
    pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,default=DEFAULT_OUT)
    parser.add_argument('--models',nargs='*')
    parser.add_argument('--trials',type=int,default=1)
    parser.add_argument('--start-trial',type=int,default=1)
    parser.add_argument('--reasoning',choices=['none','minimal','low','medium','high'])
    parser.add_argument('--max-tokens',type=int,default=8192)
    parser.add_argument('--format',choices=['fen','grid'],default='fen')
    parser.add_argument('--structured',action='store_true')
    args = parser.parse_args()
    key = os.environ['OPENROUTER_API_KEY']
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'responses').mkdir(exist_ok=True)
    catalog = json.load(urllib.request.urlopen('https://openrouter.ai/api/v1/models'))
    (args.out/'model-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    eligible = [m for m in catalog['data'] if 'image' in m['architecture'].get('input_modalities',[]) and 'text' in m['architecture'].get('output_modalities',[]) and float(m['pricing']['prompt']) == 0 and float(m['pricing']['completion']) == 0]
    excluded = ('content-safety','lyria','openrouter/free')
    models = args.models or [m['id'] for m in eligible if not any(s in m['id'] for s in excluded)]
    assert all(m in [x['id'] for x in eligible] for m in models), 'Only free vision endpoints allowed'
    (args.out/'prompt.txt').write_text(PROMPT+'\n')
    print('Models:',models,flush=True)
    jobs = [(m,i,t) for t in range(args.start_trial,args.start_trial+args.trials) for m in models for i in (1,2)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(run,m,i,t,args,key) for m,i,t in jobs]
        for future in concurrent.futures.as_completed(futures): future.result()

if __name__ == '__main__': main()
