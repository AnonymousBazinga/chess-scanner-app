"""Ask Gemini to classify actual detected objects; no square names or identities.

Boxes are automatic LeYOLO detections. Mapping uses the automatic lattice.
Missing detections stay missing and are counted as errors, never filled by truth.
"""
import argparse
import getpass
import json
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from gemini_audit import OUT,source,request
from run_openrouter import extract

def main():
    p=argparse.ArgumentParser();p.add_argument('--images',type=int,nargs='+',default=[4,2]);p.add_argument('--model',default='gemini-3.1-flash-lite');a=p.parse_args()
    key=getpass.getpass('Gemini key (hidden): ')
    for i in a.images:
        objects=json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces'];im=Image.open(source(i)).convert('RGB');predictions={}
        for start in range(0,len(objects),6):
            batch=objects[start:start+6];sheet=Image.new('RGB',(900,700),'#fff');d=ImageDraw.Draw(sheet);font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',24)
            for j,o in enumerate(batch):
                box=o['box'];crop=im.crop(tuple(int(v) for v in box));crop.thumbnail((275,305));x=(j%3)*300;y=(j//3)*350
                sheet.paste(crop,(x+(300-crop.width)//2,y+35+(305-crop.height)//2));d.text((x+10,y+3),str(start+j),font=font,fill='black')
            path=OUT/f'image{i}-object-crops-{start}.png';sheet.save(path)
            labels=list(range(start,start+len(batch)))
            prompt='Classify each numbered chess-piece photograph by its visual shape and color. Each panel is an independently detected object, not a chess square. Identify the dominant piece whose silhouette fills each crop; ignore fragments of neighboring pieces. Return JSON {"pieces":{"0":"p"},"uncertain":[]} with one entry for each label '+str(labels)+'. Symbols PNBRQK are light pawn/knight/bishop/rook/queen/king, lowercase dark. There is no assumed board position or piece inventory. Pay attention to the head: pawn ball, bishop slit/point, rook tower, knight horse, king cross/finial, queen crown. State uncertainty if this nonstandard set does not allow a reliable distinction.'
            row=request(key,a.model,[path],prompt,'generate',OUT/f'{a.model}-image{i}-object-crops-{start}.json')
            try:
                obj=json.loads(row['content']);pieces=obj['pieces']
                for label in labels:
                    value=pieces[str(label)]
                    if len(value)!=1 or value not in 'PNBRQKpnbrqk':raise ValueError('Invalid class')
                    predictions[label]=value
            except (ValueError,KeyError) as exc:print('batch failed',i,start,str(exc),flush=True)
            print(i,start,predictions,flush=True)
        corners=json.loads((OUT/f'image{i}-auto-geometry.json').read_text())['corners'];hom=cv2.getPerspectiveTransform(np.float32(corners),np.float32([[0,0],[8,0],[8,8],[0,8]]))
        board=['.']*64;collisions=[]
        for n,o in enumerate(objects):
            if n not in predictions:continue
            c,r=np.floor(cv2.perspectiveTransform(np.float32([[o['base']]]),hom)[0,0]).astype(int)
            if 0<=c<8 and 0<=r<8:
                if board[r*8+c]!='.':collisions.append([int(r),int(c)])
                else:board[r*8+c]=predictions[n]
        result={'image':i,'method':'automatic LeYOLO object boxes + Gemini classification + automatic grid','objects':len(objects),'classified':len(predictions),'identities':predictions,'collisions':collisions,'placement':extract(json.dumps({'ranks':[''.join(board[k:k+8]) for k in range(0,64,8)]}))}
        (OUT/f'{a.model}-image{i}-objects-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(result,flush=True)

if __name__=='__main__':main()
