"""Moondream sanity, reasoning and geometry-assisted crop diagnostics.

Corners are manually marked for these two photos. Crop scores are NOT automatic
end-to-end scores. Neither reference piece identities nor model identities enter
the prompts; occupancy comes from the unchanged Fenify baseline.
"""
import base64
import getpass
import io
import json
import re
import time
import cv2
import numpy as np
import requests
from PIL import Image
from direct_vision import OUT, fen_from_map
from run_openrouter import DEFAULT_OUT, SQUARES, expand, extract, score

CORNERS = {1: [[75,89],[1148,104],[1141,1160],[77,1157]],
           2: [[211,103],[997,105],[1045,697],[164,692]]}
MODEL = 'moondream3.1-9B-A2B'
TYPES = {'pawn':'p','knight':'n','bishop':'b','rook':'r','queen':'q','king':'k'}

def data_url(im):
    b=io.BytesIO();im.save(b,format='JPEG',quality=95)
    return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()

def request(key, name, im, endpoint='query', **kwargs):
    path=OUT/(name+'.json')
    if path.exists():return json.loads(path.read_text())
    start=time.monotonic()
    payload={'model':MODEL,'image_url':data_url(im),**kwargs}
    row={'model':MODEL,'endpoint':endpoint,'settings':kwargs}
    try:
        r=requests.post('https://api.moondream.ai/v1/'+endpoint,headers={'X-Moondream-Auth':key},json=payload,timeout=(15,90))
        row.update(http_status=r.status_code,response=r.json())
    except Exception as exc:row['error']=type(exc).__name__+': '+str(exc)
    row['seconds']=round(time.monotonic()-start,3)
    path.write_text(json.dumps(row,indent=2)+'\n')
    print(name, str(row.get('response',row.get('error')))[:350],flush=True)
    time.sleep(.55)
    return row

def piece(answer):
    answer=answer.lower().strip()
    names=[v for k,v in TYPES.items() if re.search(r'\b'+k+r'\b',answer)]
    white=bool(re.search(r'\b(white|light)\b',answer))
    black=bool(re.search(r'\b(black|dark|brown)\b',answer))
    if len(names)!=1 or white==black:raise ValueError('Ambiguous piece answer: '+answer)
    return names[0].upper() if white else names[0]

def crop_for(im,index,square):
    hom=cv2.getPerspectiveTransform(np.float32([[0,0],[8,0],[8,8],[0,8]]),np.float32(CORNERS[index]))
    f=ord(square[0])-97;r=8-int(square[1])
    pts=cv2.perspectiveTransform(np.float32([[[f+.5,r+.5],[f+1.5,r+.5],[f+.5,r+1.5]]]),hom)[0]
    x,y=pts[0];w=np.linalg.norm(pts[1]-pts[0]);h=np.linalg.norm(pts[2]-pts[0])
    # Tall pieces extend upward in the angled photo. In the top-down photo the
    # white pieces lean toward the camera, outside their square centers.
    top,bottom=(1.9,.48) if index==2 else ((.75,1.05) if r>=4 else (1.05,.75))
    box=[max(0,int(x-.56*w)),max(0,int(y-top*h)),min(im.width,int(x+.56*w)),min(im.height,int(y+bottom*h))]
    return im.crop(box),box

def main():
    key=getpass.getpass('Moondream key (hidden): ')
    for index in (1,2):
        im=Image.open(DEFAULT_OUT/'images'/f'image-{index}.jpg').convert('RGB')
        request(key,f'moondream-sanity-image{index}',im,question='Describe this image in one sentence.')
        request(key,f'moondream-detect-image{index}',im,endpoint='detect',object='chess piece')
        r=request(key,f'moondream-simple-fen-image{index}',im,question='Read this chess position. White is at the bottom. Give only the piece-placement FEN, rank 8 first.',reasoning=True)
        try:
            placement=extract(r['response']['answer']);result={'status':'ok','placement':placement,'score':score(placement,index)}
        except Exception as exc:result={'status':'error','error':str(exc)}
        (OUT/f'moondream-simple-score-image{index}.json').write_text(json.dumps(result,indent=2)+'\n')
        base=json.loads((DEFAULT_OUT/'local-fenify-3D.json').read_text())[index-1]
        pieces={};details=[]
        for square,p in zip(SQUARES,expand(base['placement'])):
            if p=='.':continue
            crop,box=crop_for(im,index,square)
            directory=OUT/'piece-crops';directory.mkdir(exist_ok=True)
            crop.save(directory/f'image{index}-{square}.jpg')
            prompt='What color and type is the central chess piece? Answer with only two words, for example "white pawn" or "black knight".'
            row=request(key,f'moondream-crop-image{index}-{square}',crop,question=prompt)
            detail={'square':square,'box':box,'answer':row.get('response',{}).get('answer','')}
            try:pieces[square]=piece(detail['answer'])
            except ValueError as exc:detail['error']=str(exc)
            details.append(detail)
        result={'model':MODEL,'image':index,'mode':'manual-geometry-crops','corners':CORNERS[index],'details':details,'valid_pieces':len(pieces),'required_pieces':len(details)}
        if len(pieces)==len(details):
            placement=fen_from_map(pieces);result.update(status='ok',placement=placement,score=score(placement,index))
        else:result['status']='error'
        (OUT/f'moondream-crop-score-image{index}.json').write_text(json.dumps(result,indent=2)+'\n')
        print('CROP RESULT',json.dumps({k:v for k,v in result.items() if k!='details'}),flush=True)

if __name__=='__main__':main()
