"""Geometry-assisted Gemini crop sheets; manual board corners, no piece labels."""
import base64
import getpass
import io
import json
import time
import requests
from PIL import Image,ImageDraw,ImageFont
from moondream_focused import crop_for,CORNERS
from direct_vision import OUT,parse_object,fen_from_map
from run_openrouter import DEFAULT_OUT,SQUARES,expand,score

def main():
    key=getpass.getpass('Gemini key (hidden): ')
    font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',24)
    for index in (1,2):
        im=Image.open(DEFAULT_OUT/'images'/f'image-{index}.jpg').convert('RGB')
        base=json.loads((DEFAULT_OUT/'local-fenify-3D.json').read_text())[index-1]
        squares=[s for s,p in zip(SQUARES,expand(base['placement'])) if p!='.']
        pieces={};errors=[]
        for start in range(0,len(squares),8):
            batch=squares[start:start+8];sheet=Image.new('RGB',(1000,560),'white');draw=ImageDraw.Draw(sheet)
            for i,square in enumerate(batch):
                crop,box=crop_for(im,index,square);crop.thumbnail((230,235))
                x=i%4*250;y=i//4*280
                sheet.paste(crop,(x+(250-crop.width)//2,y+36))
                draw.text((x+10,y+3),square,fill='black',font=font)
            sheet.save(OUT/f'gemini-crops-image{index}-batch{start}.jpg')
            target=OUT/f'gemini-crops-image{index}-batch{start}.json'
            if target.exists():row=json.loads(target.read_text())
            else:
                prompt='Each labeled panel contains a chess piece. Classify the central piece in each panel by its visual shape and color. Background fragments of neighboring pieces are not the target. Give JSON {"pieces":{"a8":"r"}} mapping every panel label to one FEN symbol: PNBRQK for white pawn/knight/bishop/rook/queen/king; lowercase for black. Labels: '+', '.join(batch)+'. Do not infer identities from expected starting positions.'
                b=io.BytesIO();sheet.save(b,format='PNG')
                payload={'contents':[{'parts':[{'text':prompt},{'inlineData':{'mimeType':'image/png','data':base64.b64encode(b.getvalue()).decode()}}]}],'generationConfig':{'temperature':0,'maxOutputTokens':4096,'responseMimeType':'application/json'}}
                t=time.monotonic();row={'model':'gemini-3.1-flash-lite','image':index,'mode':'manual-geometry-crop-sheet','labels':batch,'prompt':prompt}
                try:
                    r=requests.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',headers={'x-goog-api-key':key},json=payload,timeout=(15,90));body=r.json();row['http_status']=r.status_code
                    if r.status_code!=200:row['error']=body.get('error')
                    else:
                        row['usage']=body.get('usageMetadata');row['content']=''.join(p.get('text','') for p in body['candidates'][0]['content']['parts'] if not p.get('thought'))
                except Exception as exc:row['error']=str(exc)
                row['seconds']=time.monotonic()-t;target.write_text(json.dumps(row,indent=2)+'\n')
            try:
                prediction=parse_object(row['content'])['pieces']
                if set(prediction)!=set(batch):raise ValueError('Missing/extra squares')
                fen_from_map(prediction);pieces.update(prediction)
                print(index,start,prediction,flush=True)
            except Exception as exc:errors.append(str(exc));print(index,start,'error',row.get('error',str(exc)),flush=True)
        result={'model':'gemini-3.1-flash-lite','image':index,'mode':'manual-geometry-crop-sheet','corners':CORNERS[index],'errors':errors,'status':'error' if errors else 'ok'}
        if not errors:
            placement=fen_from_map(pieces);result.update(placement=placement,score=score(placement,index))
        (OUT/f'gemini-crops-score-image{index}.json').write_text(json.dumps(result,indent=2)+'\n')
        print(result,flush=True)

if __name__=='__main__':main()
